/**
 * Food Diary Plugin
 * 
 * Track what you eat with simple commands.
 * - .food <item> — Log food directly
 * - .food — Prompts you to enter what you ate
 * - .foodlog — View recent entries
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIARY_FILE = join(__dirname, "..", "data", "food-diary.json");

// Track users waiting to input food (keyed by channelType:userId)
const waitingForFood = new Set();

/**
 * Get a unique key for tracking user state across channels
 */
function getUserKey(msg) {
  return `${msg.channelType}:${msg.userId}`;
}

/**
 * Ensure data directory exists
 */
function ensureDataDir() {
  const dataDir = dirname(DIARY_FILE);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}

/**
 * Load diary entries from file
 */
function loadDiary() {
  try {
    if (existsSync(DIARY_FILE)) {
      return JSON.parse(readFileSync(DIARY_FILE, "utf-8"));
    }
  } catch (err) {
    console.error("[food-diary] Error loading diary:", err.message);
  }
  return [];
}

/**
 * Save entry to diary
 */
function saveEntry(userId, channelType, food) {
  ensureDataDir();
  
  const entries = loadDiary();
  entries.push({
    userId,
    channelType,
    food,
    timestamp: new Date().toISOString(),
  });
  
  writeFileSync(DIARY_FILE, JSON.stringify(entries, null, 2));
}

/**
 * Format date for display
 */
function formatDate(isoString) {
  const date = new Date(isoString);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default {
  name: "food-diary",

  commands: {
    food: async (msg, { reply }) => {
      const userKey = getUserKey(msg);
      const text = msg.text.replace(/^\.food\s*/i, "").trim();
      
      if (text) {
        // Direct entry: .food pizza
        await saveEntry(msg.userId, msg.channelType, text);
        await reply(`✅ Logged: ${text}`);
      } else {
        // Prompt for input
        waitingForFood.add(userKey);
        await reply("What did you eat? (Send your response)");
      }
    },

    foodlog: async (msg, { reply }) => {
      const entries = loadDiary().filter((e) => e.userId === msg.userId);
      
      if (entries.length === 0) {
        await reply("No food entries yet. Use .food to log something!");
        return;
      }

      // Show last 10 entries
      const recent = entries.slice(-10);
      const lines = recent.map(
        (e) => `• ${formatDate(e.timestamp)}: ${e.food}`
      );
      
      await reply(`🍽️ Recent meals:\n\n${lines.join("\n")}`);
    },
  },

  // Message handler to capture food input after .food prompt
  onMessage: async (msg, { reply }) => {
    const userKey = getUserKey(msg);
    
    if (waitingForFood.has(userKey)) {
      waitingForFood.delete(userKey);
      const food = msg.text.trim();
      
      if (food) {
        await saveEntry(msg.userId, msg.channelType, food);
        await reply(`✅ Logged: ${food}`);
        return true; // Handled
      }
    }
    return false; // Not handled, let other handlers process
  },
};
