/**
 * Gratitude Plugin
 *
 * Pings you once a day at a random time between 9am–8pm PT asking what you're
 * grateful for. Reply directly to the message to save it to the log.
 *
 * Commands:
 * - .gratitude   — send the prompt immediately
 * - .gratitudes  — show recent gratitude log
 *
 * Schedule: once daily, random time between 9am–8pm PT.
 * Override window with GRATITUDE_CRON env var (cron expression).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getDataDir } from "../src/runtime-paths.js";

const DATA_DIR = getDataDir();
const LOG_FILE = join(DATA_DIR, "gratitude.json");

// In-memory set of userIds with a pending prompt today
// { userId -> { channelId, channelType, date } }
const pendingPrompts = new Map();

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadLog() {
  try {
    if (existsSync(LOG_FILE)) {
      const data = JSON.parse(readFileSync(LOG_FILE, "utf-8"));
      if (Array.isArray(data)) return data;
    }
  } catch (err) {
    console.error("[gratitude] Failed to load log:", err.message);
  }
  return [];
}

function saveEntry(entry) {
  ensureDataDir();
  const log = loadLog();
  log.push(entry);
  writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

// ---------------------------------------------------------------------------
// Date helper
// ---------------------------------------------------------------------------

function todayPT() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

// ---------------------------------------------------------------------------
// Prompt + scheduling
// ---------------------------------------------------------------------------

async function sendPrompt(channel, channelId, userId) {
  const date = todayPT();
  await channel.send(channelId, "🌿 What are you grateful for today? Reply directly to this message to save it.");
  pendingPrompts.set(userId, { channelId, channelType: channel.type, date });
  console.log(`[gratitude] Sent prompt to ${userId}`);
}

/**
 * Schedule a one-time random fire within 9am–8pm PT today.
 * If current time is already past 8pm, skip today.
 */
function scheduleRandomPrompt(channel, channelId, userId) {
  const now = new Date();
  const nowPT = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));

  const startH = 9;
  const endH = 20; // 8pm

  const startToday = new Date(nowPT);
  startToday.setHours(startH, 0, 0, 0);

  const endToday = new Date(nowPT);
  endToday.setHours(endH, 0, 0, 0);

  if (nowPT >= endToday) {
    console.log("[gratitude] Past 8pm PT, skipping today's random prompt");
    return;
  }

  const earliest = Math.max(nowPT.getTime(), startToday.getTime());
  const windowMs = endToday.getTime() - earliest;
  const delayMs = Math.floor(Math.random() * windowMs);

  console.log(`[gratitude] Random prompt in ${Math.round(delayMs / 60000)}m`);
  setTimeout(() => sendPrompt(channel, channelId, userId), delayMs);
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export default {
  name: "gratitude",

  help: {
    gratitude: "Prompt yourself to log gratitude now",
    gratitudes: "Show recent gratitude log",
  },

  commands: {
    gratitude: async (msg, { reply, channel }) => {
      await channel.send(msg.channelId, "🌿 What are you grateful for today? Reply directly to this message to save it.");
      pendingPrompts.set(msg.userId, { channelId: msg.channelId, channelType: msg.channelType, date: todayPT() });
    },

    gratitudes: async (msg, { reply }) => {
      const log = loadLog().filter((e) => e.userId === msg.userId);
      if (log.length === 0) {
        await reply("No gratitude entries yet. Use `.gratitude` to log one!");
        return;
      }
      const recent = log.slice(-10);
      const lines = recent.map((e) => `📅 ${e.date}\n🌿 ${e.text}`);
      await reply(lines.join("\n\n"));
    },
  },

  onMessage: async (msg, { reply }) => {
    // Only intercept direct replies from users with a pending prompt
    if (!msg.replyToId) return false;
    if (!pendingPrompts.has(msg.userId)) return false;

    const pending = pendingPrompts.get(msg.userId);

    // Must be in the same channel
    if (pending.channelId !== msg.channelId) return false;

    const text = msg.text?.trim();
    if (!text || text.startsWith(".")) return false;

    saveEntry({
      userId: msg.userId,
      date: todayPT(),
      text,
      savedAt: new Date().toISOString(),
    });

    pendingPrompts.delete(msg.userId);

    const log = loadLog().filter((e) => e.userId === msg.userId);
    const lines = [`✅ Gratitude logged 🌿`, `"${text}"`];
    if (log.length > 1) lines.push(`${log.length} entries total.`);

    await reply(lines.join("\n"));
    return true;
  },

  schedules: [
    {
      // Fires once at midnight PT to schedule the random prompt for the day.
      cron: process.env.GRATITUDE_CRON || "0 0 * * *",

      handler: async ({ channels, config }) => {
        const targetChatId = config.plugins?.targetChatId;
        const targetChannel = config.plugins?.targetChannel || "telegram";

        if (!targetChatId) {
          console.log("[gratitude] No PLUGIN_TARGET_CHAT_ID configured, skipping");
          return;
        }

        const channel = channels.get(targetChannel);
        if (!channel) {
          console.log(`[gratitude] Channel '${targetChannel}' not available`);
          return;
        }

        scheduleRandomPrompt(channel, String(targetChatId), String(targetChatId));
      },
    },
  ],

  init: async ({ channels, config }) => {
    const targetChatId = config.plugins?.targetChatId;
    const targetChannel = config.plugins?.targetChannel || "telegram";

    if (!targetChatId) return;

    const channel = channels.get(targetChannel);
    if (!channel) return;

    // Schedule today's random prompt on startup
    scheduleRandomPrompt(channel, String(targetChatId), String(targetChatId));
  },
};
