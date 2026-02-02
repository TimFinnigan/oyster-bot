/**
 * Main Application
 * 
 * Wires together channels, plugins, and the Claude CLI.
 * This is the channel-agnostic core that routes messages.
 */

import config from "./config.js";
import { runClaude } from "./claude.js";
import { createChannels } from "./channels/index.js";
import { loadPlugins, handlePluginMessage } from "./plugin-loader.js";
import { getSessionKey } from "./types/message.js";

// Per-session tracking: sessionKey -> Claude sessionId
const sessions = new Map();
// Track active requests to prevent concurrent calls per session
const activeRequests = new Set();

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

  // Route to Claude
  await handleClaudeMessage(msg, channel);
}

/**
 * Handle built-in slash commands
 */
async function handleCommand(msg, channel) {
  const text = msg.text.toLowerCase().trim();
  const sessionKey = getSessionKey(msg);

  if (text === "/start") {
    await channel.send(
      msg.channelId,
      "Hello! I'm a Claude Code bot. Send me any message and I'll respond using Claude.\n\n" +
        "Commands:\n" +
        "/start - Show this message\n" +
        "/reset - Clear conversation history\n" +
        "/session - Show current session info"
    );
    return;
  }

  if (text === "/reset") {
    sessions.delete(sessionKey);
    await channel.send(msg.channelId, "Conversation reset. Starting fresh.");
    return;
  }

  if (text === "/session") {
    const sessionId = sessions.get(sessionKey);
    if (sessionId) {
      await channel.send(msg.channelId, `Active session: ${sessionId}`);
    } else {
      await channel.send(msg.channelId, "No active session. Send a message to start one.");
    }
    return;
  }

  // Unknown command - ignore
}

/**
 * Handle a message that should go to Claude
 */
async function handleClaudeMessage(msg, channel) {
  const sessionKey = getSessionKey(msg);

  // Prevent concurrent requests per session
  if (activeRequests.has(sessionKey)) {
    await channel.send(msg.channelId, "Still processing your previous message. Please wait.");
    return;
  }

  activeRequests.add(sessionKey);

  // Start typing indicator
  await channel.sendTyping(msg.channelId);
  const typingInterval = setInterval(() => {
    channel.sendTyping(msg.channelId).catch(() => {});
  }, 4000);

  try {
    const sessionId = sessions.get(sessionKey);
    const result = await runClaude(msg.text, sessionId);

    // Store session ID for conversation continuity
    if (result.session_id) {
      sessions.set(sessionKey, result.session_id);
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
    activeRequests.delete(sessionKey);
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
  await loadPlugins({ channels, config, runClaude });

  // Start all channels
  for (const [type, channel] of channels) {
    await channel.start();
    console.log(`[app] Started channel: ${type}`);
  }

  console.log("[app] Bot is running. Press Ctrl+C to stop.");

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n[app] Received ${signal}, shutting down...`);
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
