/**
 * Gratitude Plugin
 *
 * Log things you're grateful for and look back on them.
 * - .thanks <thing> — Log something you're grateful for
 * - .thanks — Prompts you to enter what you're grateful for
 * - .grateful — View your gratitude log
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, "..", "data", "gratitude.json");

const waitingForThanks = new Set();

function getUserKey(msg) {
  return `${msg.channelType}:${msg.userId}`;
}

function ensureDataDir() {
  const dataDir = dirname(DATA_FILE);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}

function loadEntries() {
  try {
    if (existsSync(DATA_FILE)) {
      return JSON.parse(readFileSync(DATA_FILE, "utf-8"));
    }
  } catch (err) {
    console.error("[gratitude] Error loading entries:", err.message);
  }
  return [];
}

function saveEntries(entries) {
  ensureDataDir();
  writeFileSync(DATA_FILE, JSON.stringify(entries, null, 2));
}

function addEntry(userId, channelType, text) {
  const entries = loadEntries();
  entries.push({
    userId,
    channelType,
    text,
    createdAt: new Date().toISOString(),
  });
  saveEntries(entries);
}

export default {
  name: "gratitude",

  commands: {
    thanks: async (msg, { reply }) => {
      const userKey = getUserKey(msg);
      const text = msg.text.replace(/^\.thanks\s*/i, "").trim();

      if (text) {
        addEntry(msg.userId, msg.channelType, text);
        await reply(`Logged: grateful for ${text}`);
      } else {
        waitingForThanks.add(userKey);
        await reply("What are you grateful for? (Send your response)");
      }
    },

    grateful: async (msg, { reply }) => {
      const entries = loadEntries().filter((e) => e.userId === msg.userId);

      if (entries.length === 0) {
        await reply("No entries yet. Use .thanks to log something you're grateful for!");
        return;
      }

      const lines = entries.map((e, i) => {
        const date = new Date(e.createdAt).toLocaleDateString();
        return `${i + 1}. ${e.text} (${date})`;
      });
      await reply(`Your gratitude log:\n\n${lines.join("\n")}`);
    },
  },

  onMessage: async (msg, { reply }) => {
    const userKey = getUserKey(msg);

    if (waitingForThanks.has(userKey)) {
      waitingForThanks.delete(userKey);
      const text = msg.text.trim();

      if (text) {
        addEntry(msg.userId, msg.channelType, text);
        await reply(`Logged: grateful for ${text}`);
        return true;
      }
    }
    return false;
  },
};
