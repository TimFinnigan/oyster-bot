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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

// Per-session tracking: provider:sessionKey -> sessionId
const SESSIONS_FILE = join(config.paths.dataDir, "chat-sessions.json");

function loadPersistedSessions() {
  try {
    if (!existsSync(SESSIONS_FILE)) return new Map();
    const data = JSON.parse(readFileSync(SESSIONS_FILE, "utf8"));
    if (!data || typeof data !== "object") return new Map();
    return new Map(Object.entries(data).filter(([, value]) => typeof value === "string" && value.length > 0));
  } catch (err) {
    console.error("[app] Failed to load persisted sessions:", err.message);
    return new Map();
  }
}

function persistSessions() {
  try {
    mkdirSync(config.paths.dataDir, { recursive: true });
    writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions), null, 2));
  } catch (err) {
    console.error("[app] Failed to persist sessions:", err.message);
  }
}

const sessions = loadPersistedSessions();
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
    persistSessions();
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
  let provider = activeProvider;

  const attemptWithProvider = async (providerName, { notifyBusy = true } = {}) => {
    const targetSessionKey = getProviderSessionKey(providerName, sessionKey);
    if (activeRequests.has(targetSessionKey)) {
      if (notifyBusy) {
        await channel.send(msg.channelId, "Still processing your previous message. Please wait.");
      }
      return false;
    }

    activeRequests.add(targetSessionKey);

    try {
      const sessionId = sessions.get(targetSessionKey);
      const result = await runAI(msg.text, sessionId, providerName);

      const returnedSessionId = result.session_id || result.sessionId || null;
      if (returnedSessionId) {
        sessions.set(targetSessionKey, returnedSessionId);
        persistSessions();
      }

      const responseText =
        result.result || result.content || "(no response)";

      const chunks = splitMessage(responseText);
      for (const chunk of chunks) {
        await channel.send(msg.channelId, chunk);
      }

      return true;
    } finally {
      activeRequests.delete(targetSessionKey);
    }
  };

  // Start typing indicator
  await channel.sendTyping(msg.channelId);
  const typingInterval = setInterval(() => {
    channel.sendTyping(msg.channelId).catch(() => {});
  }, 4000);

  try {
    const handled = await attemptWithProvider(provider);
    if (!handled) {
      return;
    }
  } catch (err) {
    const errorMessage = err?.message || "Unknown error";
    console.error("[app] Error:", errorMessage);

    const shouldFailover =
      provider === "claude" && errorMessage.includes("Claude exited with code 1");

    if (shouldFailover) {
      sessions.delete(getProviderSessionKey("claude", sessionKey));
      persistSessions();
      activeProvider = "codex";
      provider = "codex";
      console.warn("[app] Claude failed with exit code 1. Switching to codex and retrying...");
      await channel.send(
        msg.channelId,
        "Claude crashed (exit code 1). Switching to codex and retrying your request..."
      );

      try {
        const fallbackHandled = await attemptWithProvider("codex");
        if (!fallbackHandled) {
          return;
        }
        return;
      } catch (fallbackErr) {
        const fallbackMessage = fallbackErr?.message || "Unknown fallback error";
        console.error("[app] Codex fallback error:", fallbackMessage);
        await channel.send(
          msg.channelId,
          `Fallback to codex also failed: ${fallbackMessage.slice(0, 500)}`
        );
        return;
      }
    }

    await channel.send(msg.channelId, `Error: ${errorMessage.slice(0, 500)}`);
  } finally {
    clearInterval(typingInterval);
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
