/**
 * Chat Export Plugin
 *
 * Collects all Telegram messages throughout the day and exports them
 * to a markdown file at 11:50 PM Pacific Time.
 *
 * Messages are persisted to a JSONL file on disk (async, non-blocking)
 * so they survive restarts and reloads.
 *
 * - Cron job reads the day's JSONL, writes data/chat-logs/YYYY-MM-DD.md
 * - .exportchat — Manually export today's messages so far
 *
 * Environment variables:
 * - CHAT_EXPORT_CRON: Cron expression for nightly export (default: "50 23 * * *")
 * - CHAT_EXPORT_TZ: Timezone for the cron schedule (default: system time)
 */

import { appendFile, readFile, writeFile, rm } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const LOGS_DIR = join(DATA_DIR, "chat-logs");

// Ensure directories exist on load
if (!existsSync(LOGS_DIR)) {
  mkdirSync(LOGS_DIR, { recursive: true });
}

/**
 * Get today's date in Pacific Time as YYYY-MM-DD
 */
function getTodayPT() {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Los_Angeles",
  });
}

/**
 * Get a formatted timestamp in Pacific Time
 */
function formatTimePT(date) {
  return new Date(date).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

/**
 * Path to today's JSONL buffer file
 */
function getBufferPath(date) {
  return join(LOGS_DIR, `${date}.jsonl`);
}

/**
 * Append a message to the JSONL buffer (async, non-blocking)
 */
function appendMessage(entry) {
  const today = getTodayPT();
  const line = JSON.stringify({ ...entry, timestamp: Date.now() }) + "\n";
  // Fire and forget — don't await in the caller
  appendFile(getBufferPath(today), line, "utf8").catch((err) => {
    console.error("[chat-export] Failed to append message:", err.message);
  });
}

/**
 * Read all messages from today's JSONL buffer
 */
async function readMessages(date) {
  const filePath = getBufferPath(date);
  try {
    const raw = await readFile(filePath, "utf8");
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

/**
 * Format messages into markdown
 */
function formatMarkdown(date, messages) {
  const lines = [`# Chat Log — ${date}`, ""];

  if (messages.length === 0) {
    lines.push("_No messages recorded today._");
    return lines.join("\n");
  }

  for (const m of messages) {
    const time = formatTimePT(m.timestamp);
    const sender = m.isBot ? "🤖 Bot" : `👤 ${m.userName}`;
    lines.push(`**[${time}] ${sender}:**`);
    lines.push(m.text);
    lines.push("");
  }

  lines.push("---");
  lines.push(`_${messages.length} message(s) exported._`);
  return lines.join("\n");
}

/**
 * Read JSONL, write markdown, return path
 */
async function exportToFile(date) {
  const messages = await readMessages(date);
  const filePath = join(LOGS_DIR, `${date}.md`);
  const content = formatMarkdown(date, messages);
  await writeFile(filePath, content, "utf8");
  return { filePath, count: messages.length };
}

export default {
  name: "chat-export",

  commands: {
    /**
     * Manually export today's chat so far
     * Usage: .exportchat
     */
    exportchat: async (msg, { reply }) => {
      const today = getTodayPT();
      const { filePath, count } = await exportToFile(today);
      await reply(`Exported ${count} message(s) to:\n${filePath}`);
    },
  },

  /**
   * Capture every incoming message
   * Returns false so other handlers still process it
   */
  onMessage: async (msg) => {
    appendMessage({
      userName: msg.userName || "Unknown",
      userId: msg.userId,
      text: msg.text || "(non-text message)",
      isBot: false,
    });
    return false;
  },

  /**
   * Capture bot responses (called from app.js via notifyOutgoingMessage)
   */
  onOutgoingMessage: async ({ text }) => {
    appendMessage({
      userName: "Bot",
      userId: "bot",
      text: text || "(empty response)",
      isBot: true,
    });
  },

  schedules: [
    {
      cron: process.env.CHAT_EXPORT_CRON || "50 23 * * *",
      ...(process.env.CHAT_EXPORT_TZ && { timezone: process.env.CHAT_EXPORT_TZ }),

      handler: async ({ channels, config }) => {
        const today = getTodayPT();
        const { filePath, count } = await exportToFile(today);

        console.log(
          `[chat-export] Nightly export: ${count} message(s) for ${today}`
        );

        // Notify on Telegram
        const targetChatId = config.plugins?.targetChatId;
        const targetChannel = config.plugins?.targetChannel || "telegram";
        const channel = channels.get(targetChannel);

        if (channel && targetChatId) {
          await channel.send(
            String(targetChatId),
            `📝 Chat log exported (${count} messages): ${today}.md`
          );
        }

        // Remove the JSONL buffer now that the .md is written
        try {
          await rm(getBufferPath(today), { force: true });
        } catch {
          // ignore
        }
      },
    },
  ],
};
