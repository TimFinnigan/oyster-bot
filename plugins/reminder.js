/**
 * Reminder Plugin
 * 
 * Set reminders that will notify you after a specified time.
 * - .reminder <text> <time> — Set a reminder (e.g., .reminder take out trash 30m)
 * - .reminders — View your pending reminders
 * - .cancelreminder <id> — Cancel a reminder by ID
 * 
 * Time formats: 30s, 5m, 2h, 1d (seconds, minutes, hours, days)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REMINDERS_FILE = join(__dirname, "..", "data", "reminders.json");

// Active timeout IDs for cancellation (keyed by reminder ID)
const activeTimeouts = new Map();

// Store references for sending reminders
let _channels = null;

/**
 * Ensure data directory exists
 */
function ensureDataDir() {
  const dataDir = dirname(REMINDERS_FILE);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}

/**
 * Load reminders from file
 */
function loadReminders() {
  try {
    if (existsSync(REMINDERS_FILE)) {
      return JSON.parse(readFileSync(REMINDERS_FILE, "utf-8"));
    }
  } catch (err) {
    console.error("[reminder] Error loading reminders:", err.message);
  }
  return [];
}

/**
 * Save reminders to file
 */
function saveReminders(reminders) {
  ensureDataDir();
  writeFileSync(REMINDERS_FILE, JSON.stringify(reminders, null, 2));
}

/**
 * Generate a short unique ID
 */
function generateId() {
  return Math.random().toString(36).substring(2, 8);
}

/**
 * Parse time string like "5m", "2h", "30s", "1d" into milliseconds
 * Returns null if invalid
 */
function parseTime(timeStr) {
  const match = timeStr.match(/^(\d+(?:\.\d+)?)\s*(s|sec|seconds?|m|min|minutes?|h|hr|hours?|d|days?)$/i);
  if (!match) return null;
  
  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  
  const multipliers = {
    s: 1000,
    sec: 1000,
    second: 1000,
    seconds: 1000,
    m: 60 * 1000,
    min: 60 * 1000,
    minute: 60 * 1000,
    minutes: 60 * 1000,
    h: 60 * 60 * 1000,
    hr: 60 * 60 * 1000,
    hour: 60 * 60 * 1000,
    hours: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
  };
  
  return value * multipliers[unit];
}

/**
 * Format duration in a human-readable way
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days} day${days > 1 ? "s" : ""}`;
  if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""}`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? "s" : ""}`;
  return `${seconds} second${seconds !== 1 ? "s" : ""}`;
}

/**
 * Send reminder to user
 */
async function sendReminder(reminder) {
  if (!_channels) {
    console.error("[reminder] Channels not initialized");
    return;
  }
  
  const channel = _channels.get(reminder.channelType);
  if (!channel) {
    console.error(`[reminder] Channel '${reminder.channelType}' not available`);
    return;
  }
  
  try {
    await channel.send(reminder.channelId, `⏰ Reminder: ${reminder.text}`);
    console.log(`[reminder] Sent reminder: ${reminder.id}`);
  } catch (err) {
    console.error(`[reminder] Failed to send reminder:`, err.message);
  }
  
  // Remove from storage
  const reminders = loadReminders().filter(r => r.id !== reminder.id);
  saveReminders(reminders);
  activeTimeouts.delete(reminder.id);
}

/**
 * Schedule a reminder
 */
function scheduleReminder(reminder) {
  const now = Date.now();
  const triggerAt = new Date(reminder.triggerAt).getTime();
  const delay = triggerAt - now;
  
  if (delay <= 0) {
    // Already past due, send immediately
    sendReminder(reminder);
    return;
  }
  
  const timeoutId = setTimeout(() => sendReminder(reminder), delay);
  activeTimeouts.set(reminder.id, timeoutId);
}

/**
 * Restore pending reminders from storage (called on startup via schedule)
 */
function restoreReminders() {
  const reminders = loadReminders();
  const now = Date.now();
  let restored = 0;
  let expired = 0;
  
  for (const reminder of reminders) {
    const triggerAt = new Date(reminder.triggerAt).getTime();
    if (triggerAt > now) {
      scheduleReminder(reminder);
      restored++;
    } else {
      // Expired while bot was offline - send now
      sendReminder(reminder);
      expired++;
    }
  }
  
  if (restored > 0 || expired > 0) {
    console.log(`[reminder] Restored ${restored} pending reminder(s), sent ${expired} expired reminder(s)`);
  }
}

export default {
  name: "reminder",

  commands: {
    reminder: async (msg, { reply, channels }) => {
      // Store channels reference if not already set
      if (!_channels) _channels = channels;
      
      // Parse: .reminder <text> <time>
      // Time is expected at the end
      const input = msg.text.replace(/^\.reminder\s*/i, "").trim();
      
      if (!input) {
        await reply("Usage: `.reminder <text> <time>`\nExample: `.reminder take out trash 30m`\n\nTime formats: `30s`, `5m`, `2h`, `1d`");
        return;
      }
      
      // Try to extract time from the end of the input
      const parts = input.split(/\s+/);
      const lastPart = parts[parts.length - 1];
      const timeMs = parseTime(lastPart);
      
      if (!timeMs) {
        await reply("❌ Invalid time format. Use formats like: `30s`, `5m`, `2h`, `1d`\n\nExample: `.reminder call mom 1h`");
        return;
      }
      
      const text = parts.slice(0, -1).join(" ");
      if (!text) {
        await reply("❌ Please specify what to remind you about.\n\nExample: `.reminder take out trash 30m`");
        return;
      }
      
      const reminder = {
        id: generateId(),
        userId: msg.userId,
        channelType: msg.channelType,
        channelId: msg.channelId,
        text,
        createdAt: new Date().toISOString(),
        triggerAt: new Date(Date.now() + timeMs).toISOString(),
      };
      
      // Save to file
      const reminders = loadReminders();
      reminders.push(reminder);
      saveReminders(reminders);
      
      // Schedule
      scheduleReminder(reminder);
      
      await reply(`✅ Reminder set for ${formatDuration(timeMs)} from now.\n📝 "${text}"`);
    },

    reminders: async (msg, { reply }) => {
      const reminders = loadReminders().filter(r => r.userId === msg.userId);
      
      if (reminders.length === 0) {
        await reply("No pending reminders. Use `.reminder <text> <time>` to set one!");
        return;
      }
      
      const lines = reminders.map(r => {
        const timeLeft = new Date(r.triggerAt).getTime() - Date.now();
        const status = timeLeft > 0 ? `in ${formatDuration(timeLeft)}` : "sending soon";
        return `• [${r.id}] "${r.text}" — ${status}`;
      });
      
      await reply(`⏰ Your reminders:\n\n${lines.join("\n")}\n\nCancel with: \`.cancelreminder <id>\``);
    },

    cancelreminder: async (msg, { reply }) => {
      const id = msg.text.replace(/^\.cancelreminder\s*/i, "").trim();
      
      if (!id) {
        await reply("Usage: `.cancelreminder <id>`\nUse `.reminders` to see your reminder IDs.");
        return;
      }
      
      const reminders = loadReminders();
      const index = reminders.findIndex(r => r.id === id && r.userId === msg.userId);
      
      if (index === -1) {
        await reply(`❌ Reminder with ID "${id}" not found.`);
        return;
      }
      
      // Cancel timeout if active
      if (activeTimeouts.has(id)) {
        clearTimeout(activeTimeouts.get(id));
        activeTimeouts.delete(id);
      }
      
      // Remove from storage
      const cancelled = reminders[index];
      reminders.splice(index, 1);
      saveReminders(reminders);
      
      await reply(`✅ Cancelled reminder: "${cancelled.text}"`);
    },
  },

  // Restore reminders on first schedule tick after startup
  schedules: [
    {
      // Runs every minute to restore reminders after bot restart
      cron: "* * * * *",
      handler: async ({ channels }) => {
        if (!_channels) {
          _channels = channels;
          restoreReminders();
        }
      },
    },
  ],
};
