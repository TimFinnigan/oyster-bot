/**
 * Quotes Plugin
 *
 * Sends real, inspiring quotes using Claude.
 * - .quote command: get a quote on demand
 * - Scheduled: sends a quote at the configured interval (default: hourly)
 *
 * Tracks past quotes in data/quotes-log.json to avoid duplicates.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const QUOTES_FILE = join(DATA_DIR, "quotes-log.json");

function loadPastQuotes() {
  try {
    if (existsSync(QUOTES_FILE)) {
      return JSON.parse(readFileSync(QUOTES_FILE, "utf-8"));
    }
  } catch (err) {
    console.error("[quotes] Error loading quotes log:", err.message);
  }
  return [];
}

function saveQuote(quote) {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  const log = loadPastQuotes();
  log.push({ quote, date: new Date().toISOString() });
  writeFileSync(QUOTES_FILE, JSON.stringify(log, null, 2));
}

function buildPrompt() {
  const past = loadPastQuotes();
  let avoidClause = "";
  if (past.length > 0) {
    // Send the last 50 to keep prompt size reasonable
    const recent = past.slice(-50).map((q) => q.quote).join("\n");
    avoidClause = `\n\nDo NOT repeat any of these previously sent quotes:\n${recent}`;
  }

  return `Share a real, inspiring quote from a real person (entrepreneur, scientist, author, philosopher, athlete, etc.). It must be a genuine quote that the person actually said or wrote — not made up. Include the attribution.

Format: "<quote>" — <Person Name>

Keep it under 280 characters total. Output only the formatted quote, nothing else.${avoidClause}`;
}

async function getQuote(claude) {
  const result = await claude(buildPrompt());
  const quote = result.result || result.content || "Stay positive!";
  saveQuote(quote);
  return quote;
}

export default {
  name: "quotes",

  commands: {
    quote: async (msg, { sendTyping, reply, claude }) => {
      await sendTyping();
      const quote = await getQuote(claude);
      await reply(`✨ ${quote}`);
    },
  },

  schedules: [
    {
      // Default: every hour on the hour. Override with QUOTES_CRON env var.
      cron: process.env.QUOTES_CRON || "0 * * * *",

      handler: async ({ channels, config, claude }) => {
        const targetChatId = config.plugins?.targetChatId;
        const targetChannel = config.plugins?.targetChannel || "telegram";

        if (!targetChatId) {
          console.log("[quotes] No PLUGIN_TARGET_CHAT_ID configured, skipping scheduled quote");
          return;
        }

        const channel = channels.get(targetChannel);
        if (!channel) {
          console.log(`[quotes] Channel '${targetChannel}' not available, skipping scheduled quote`);
          return;
        }

        try {
          const quote = await getQuote(claude);
          await channel.send(String(targetChatId), `✨ ${quote}`);
          console.log("[quotes] Sent scheduled quote");
        } catch (err) {
          console.error("[quotes] Failed to send scheduled quote:", err.message);
        }
      },
    },
  ],
};
