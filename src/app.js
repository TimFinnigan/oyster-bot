/**
 * Main Application
 * 
 * Wires together channels, plugins, and the Claude CLI.
 * This is the channel-agnostic core that routes messages.
 */

import config from "./config.js";
import { runAI, getConfiguredProvider, normalizeProvider, SUPPORTED_AI_PROVIDERS } from "./ai.js";
import { createChannels } from "./channels/index.js";
import { loadPlugins, handlePluginMessage, destroyPlugins } from "./plugin-loader.js";
import { getSessionKey } from "./types/message.js";

// Per-session tracking: provider:sessionKey -> sessionId
const sessions = new Map();
// Track active requests to prevent concurrent calls per session
const activeRequests = new Set();
// Runtime provider can be switched via /switch
let activeProvider = getConfiguredProvider();

function getProviderSessionKey(provider, sessionKey) {
  return `${provider}:${sessionKey}`;
}

/**
 * Split a message into chunks that fit within the limit
 */
function splitMessage(text, maxLen = config.maxMessageLength) {
  if (text.length <= maxLen) return [text];

  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a newline
    let splitIdx = remaining.lastIndexOf("\n", maxLen);
    if (splitIdx === -1 || splitIdx < maxLen / 2) {
      splitIdx = maxLen;
    }
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx);
  }
  return chunks;
}

/**
 * Handle an incoming message
 */
async function handleMessage(msg, channels) {
  const channel = channels.get(msg.channelType);
  if (!channel) {
    console.error(`[app] No channel for type: ${msg.channelType}`);
    return;
  }

  // Auth check
  if (!channel.isAllowed(msg.userId)) {
    console.log(`[app] Unauthorized user: ${msg.userId} on ${msg.channelType}`);
    return;
  }

  // Check for .commands (plugin commands use . prefix)
  if (msg.text.startsWith(".")) {
    const pluginHandled = await handlePluginMessage(msg);
    if (pluginHandled) return;
    const cmdName = msg.text.slice(1).split(/\s+/)[0];
    await channel.send(msg.channelId, `Unknown command: .${cmdName}\nTry .reload if you recently added a plugin.`);
    return;
  }

  // Check if a plugin wants to handle this message (for follow-up input)
  const pluginHandled = await handlePluginMessage(msg);
  if (pluginHandled) return;

  // Handle built-in commands
  if (msg.text.startsWith("/")) {
    await handleCommand(msg, channel);
    return;
  }

  // Route to AI provider
  await handleAIMessage(msg, channel);
}

/**
 * Handle built-in slash commands
 */
async function handleCommand(msg, channel) {
  const text = msg.text.toLowerCase().trim();
  const rawText = (msg.text || "").trim();
  const parts = rawText.split(/\s+/);
  const sessionKey = getSessionKey(msg);
  const providerSessionKey = getProviderSessionKey(activeProvider, sessionKey);

  if (text === "/start") {
    await channel.send(
      msg.channelId,
      `Hello! I'm an AI CLI bot. Send me any message and I'll respond using ${activeProvider}.\n\n` +
        "Commands:\n" +
        "/start - Show this message\n" +
        "/reset - Clear conversation history\n" +
        "/session - Show current session info\n" +
        "/switch <claude|codex> - Switch AI provider"
    );
    return;
  }

  if (text === "/reset") {
    sessions.delete(providerSessionKey);
    await channel.send(msg.channelId, `Conversation reset for provider: ${activeProvider}`);
    return;
  }

  if (text === "/session") {
    const sessionId = sessions.get(providerSessionKey);
    if (sessionId) {
      await channel.send(msg.channelId, `Provider: ${activeProvider}\nActive session: ${sessionId}`);
    } else {
      await channel.send(msg.channelId, `Provider: ${activeProvider}\nNo active session. Send a message to start one.`);
    }
    return;
  }

  if (parts[0]?.toLowerCase() === "/switch") {
    const requestedProvider = normalizeProvider(parts[1]);
    if (!requestedProvider) {
      await channel.send(
        msg.channelId,
        `Usage: /switch <provider>\nAvailable providers: ${SUPPORTED_AI_PROVIDERS.join(", ")}`
      );
      return;
    }
    activeProvider = requestedProvider;
    await channel.send(msg.channelId, `Switched AI provider to: ${activeProvider}`);
    return;
  }

  // Unknown command - ignore
}

/**
 * Handle a message that should go to configured AI provider
 */
async function handleAIMessage(msg, channel) {
  const sessionKey = getSessionKey(msg);
  const provider = activeProvider;
  const providerSessionKey = getProviderSessionKey(provider, sessionKey);

  // Prevent concurrent requests per session
  if (activeRequests.has(providerSessionKey)) {
    await channel.send(msg.channelId, "Still processing your previous message. Please wait.");
    return;
  }

  activeRequests.add(providerSessionKey);

  // Start typing indicator
  await channel.sendTyping(msg.channelId);
  const typingInterval = setInterval(() => {
    channel.sendTyping(msg.channelId).catch(() => {});
  }, 4000);

  try {
    const sessionId = sessions.get(providerSessionKey);
    const result = await runAI(msg.text, sessionId, provider);

    // Store session ID for conversation continuity
    if (result.session_id) {
      sessions.set(providerSessionKey, result.session_id);
    }

    // Extract the text response
    const responseText =
      result.result || result.content || JSON.stringify(result, null, 2);

    // Send response (split if needed)
    const chunks = splitMessage(responseText);
    for (const chunk of chunks) {
      await channel.send(msg.channelId, chunk);
    }
  } catch (err) {
    console.error("[app] Error:", err.message);
    await channel.send(msg.channelId, `Error: ${err.message.slice(0, 500)}`);
  } finally {
    clearInterval(typingInterval);
    activeRequests.delete(providerSessionKey);
  }
}

/**
 * Start the application
 */
async function start() {
  console.log("[app] Starting...");

  // Create channel instances
  const channels = createChannels(config.channels);
  console.log(`[app] Enabled channels: ${[...channels.keys()].join(", ")}`);

  // Set up message handlers for each channel
  for (const [type, channel] of channels) {
    channel.onMessage = (msg) => handleMessage(msg, channels);
    console.log(`[app] Registered message handler for: ${type}`);
  }

  // Load plugins
  await loadPlugins({ channels, config, runClaude: (prompt, sessionId = null) => runAI(prompt, sessionId, activeProvider) });

  // Start all channels
  for (const [type, channel] of channels) {
    await channel.start();
    console.log(`[app] Started channel: ${type}`);
  }

  console.log("[app] Bot is running. Press Ctrl+C to stop.");

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n[app] Received ${signal}, shutting down...`);
    await destroyPlugins();
    for (const [type, channel] of channels) {
      await channel.stop();
      console.log(`[app] Stopped channel: ${type}`);
    }
    process.exit(0);
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

start().catch((err) => {
  console.error("[app] Failed to start:", err);
  process.exit(1);
});
