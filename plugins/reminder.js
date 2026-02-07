/**
 * Reminder Plugin
 *
 * Set reminders that will notify you after a specified time.
 * - .reminder <text> <time> — Set a reminder (e.g., .reminder take out trash 30m)
 * - .reminders — View your pending reminders
 * - .reminderlog — View completed reminder history
 * - .cancelreminder <id> — Cancel a reminder or recurring reminder by ID
 * - .every <time> <text> — Set a daily recurring reminder (e.g., .every 10pm are you in bed yet?)
 * - .recurring — View your active recurring reminders
 *
 * Time formats: 30s, 5m, 2h, 1d (seconds, minutes, hours, days)
 * Clock time formats (for .every): 10pm, 8:30am, 22:00, 14:30
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REMINDERS_FILE = join(__dirname, "..", "data", "reminders.json");
const HISTORY_FILE = join(__dirname, "..", "data", "reminder-history.json");
const RECURRING_FILE = join(__dirname, "..", "data", "recurring-reminders.json");

// Active timeout IDs for cancellation (keyed by reminder ID)
const activeTimeouts = new Map();

// Store references for sending reminders
let _channels = null;
let _registerNotification = null;
let _unregisterNotification = null;

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
 * Load reminder history from file
 */
function loadHistory() {
  try {
    if (existsSync(HISTORY_FILE)) {
      return JSON.parse(readFileSync(HISTORY_FILE, "utf-8"));
    }
  } catch (err) {
    console.error("[reminder] Error loading history:", err.message);
  }
  return [];
}

/**
 * Save completed reminder to history
 */
function saveToHistory(reminder, status = "completed") {
  ensureDataDir();
  
  const history = loadHistory();
  history.push({
    ...reminder,
    status,
    completedAt: new Date().toISOString(),
  });
  
  writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

/**
 * Load recurring reminders from file
 */
function loadRecurring() {
  try {
    if (existsSync(RECURRING_FILE)) {
      return JSON.parse(readFileSync(RECURRING_FILE, "utf-8"));
    }
  } catch (err) {
    console.error("[reminder] Error loading recurring reminders:", err.message);
  }
  return [];
}

/**
 * Save recurring reminders to file
 */
function saveRecurring(recurring) {
  ensureDataDir();
  writeFileSync(RECURRING_FILE, JSON.stringify(recurring, null, 2));
}

/**
 * Parse a clock time string like "10pm", "8:30am", "22:00" into { hour, minute }.
 * Returns null if invalid.
 */
function parseClockTime(str) {
  // 12-hour format: 10pm, 8:30am, 12:00am
  const match12 = str.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (match12) {
    let hour = parseInt(match12[1], 10);
    const minute = match12[2] ? parseInt(match12[2], 10) : 0;
    const period = match12[3].toLowerCase();

    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;

    if (period === "am" && hour === 12) hour = 0;
    else if (period === "pm" && hour !== 12) hour += 12;

    return { hour, minute };
  }

  // 24-hour format: 22:00, 14:30, 0:00
  const match24 = str.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const hour = parseInt(match24[1], 10);
    const minute = parseInt(match24[2], 10);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return { hour, minute };
  }

  return null;
}

/**
 * Get the next occurrence of a given clock time as a Date.
 * If the time has already passed today, returns tomorrow's occurrence.
 */
function getNextOccurrence(hour, minute) {
  const now = new Date();
  const next = new Date();
  next.setHours(hour, minute, 0, 0);

  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}

/**
 * Format a clock time { hour, minute } for display
 */
function formatClockTime(hour, minute) {
  const period = hour >= 12 ? "pm" : "am";
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return minute === 0
    ? `${displayHour}${period}`
    : `${displayHour}:${String(minute).padStart(2, "0")}${period}`;
}

/**
 * Send a recurring reminder and re-schedule for the next day
 */
async function sendRecurringReminder(recurring) {
  if (!_channels) {
    console.error("[reminder] Channels not initialized");
    return;
  }

  const channel = _channels.get(recurring.channelType);
  if (!channel) {
    console.error(`[reminder] Channel '${recurring.channelType}' not available`);
    return;
  }

  try {
    await channel.send(recurring.channelId, `🔁 Recurring reminder: ${recurring.text}`);
    console.log(`[reminder] Sent recurring reminder: ${recurring.id}`);
  } catch (err) {
    console.error(`[reminder] Failed to send recurring reminder:`, err.message);
  }

  // Re-schedule for tomorrow
  scheduleRecurring(recurring);
}

/**
 * Schedule a recurring reminder for its next occurrence
 */
function scheduleRecurring(recurring) {
  // Clear any existing timeout to prevent duplicates
  if (activeTimeouts.has(recurring.id)) {
    clearTimeout(activeTimeouts.get(recurring.id));
  }

  const next = getNextOccurrence(recurring.hour, recurring.minute);
  const delay = next.getTime() - Date.now();

  const timeoutId = setTimeout(() => sendRecurringReminder(recurring), delay);
  activeTimeouts.set(recurring.id, timeoutId);
  if (_registerNotification) {
    _registerNotification(recurring.id, {
      pluginName: "reminder",
      label: recurring.text,
      type: "recurring",
      nextAt: next.toISOString(),
      meta: { hour: recurring.hour, minute: recurring.minute },
    });
  }
}

/**
 * Restore recurring reminders from storage on startup
 */
function restoreRecurring() {
  const recurring = loadRecurring();
  let restored = 0;

  for (const r of recurring) {
    scheduleRecurring(r);
    restored++;
  }

  if (restored > 0) {
    console.log(`[reminder] Restored ${restored} recurring reminder(s)`);
  }
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
  
  // Save to history before removing
  saveToHistory(reminder, "completed");
  
  // Remove from active storage
  const reminders = loadReminders().filter(r => r.id !== reminder.id);
  saveReminders(reminders);
  activeTimeouts.delete(reminder.id);
  if (_unregisterNotification) _unregisterNotification(reminder.id);
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
  if (_registerNotification) {
    _registerNotification(reminder.id, {
      pluginName: "reminder",
      label: reminder.text,
      type: "reminder",
      nextAt: reminder.triggerAt,
    });
  }
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
      // Expired while bot was offline - stagger sends to avoid burst
      const staggerDelay = expired * 500;
      setTimeout(() => sendReminder(reminder), staggerDelay);
      expired++;
    }
  }

  if (restored > 0 || expired > 0) {
    console.log(`[reminder] Restored ${restored} pending reminder(s), sending ${expired} expired reminder(s) (staggered)`);
  }
}

export default {
  name: "reminder",

  help: {
    reminder: "Set a reminder (e.g., .reminder call mom 30m)",
    reminders: "View pending reminders",
    cancelreminder: "Cancel a reminder by ID",
    every: "Set a daily recurring reminder (e.g., .every 10pm stretch)",
    recurring: "View active recurring reminders",
    reminderlog: "View completed reminder history",
  },

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

      const lines = reminders.map((r, i) => {
        const timeLeft = new Date(r.triggerAt).getTime() - Date.now();
        const status = timeLeft > 0 ? `in ${formatDuration(timeLeft)}` : "sending soon";
        return `${i + 1}. "${r.text}" — ${status}`;
      });

      await reply(`⏰ Your reminders:\n\n${lines.join("\n")}\n\nCancel with: \`.cancelreminder <number>\``);
    },

    cancelreminder: async (msg, { reply }) => {
      const input = msg.text.replace(/^\.cancelreminder\s*/i, "").trim();

      if (!input) {
        await reply("Usage: `.cancelreminder <id or number>`\nUse `.reminders` or `.recurring` to see your reminders.");
        return;
      }

      // Check one-time reminders first
      const reminders = loadReminders();
      const userReminders = reminders.filter(r => r.userId === msg.userId);

      // Try to find by number (1-indexed) or by ID
      let cancelled = null;
      let isRecurring = false;
      const num = parseInt(input, 10);

      if (!isNaN(num) && num >= 1 && num <= userReminders.length) {
        cancelled = userReminders[num - 1];
      } else {
        cancelled = userReminders.find(r => r.id === input);
      }

      if (cancelled) {
        // Cancel timeout if active
        if (activeTimeouts.has(cancelled.id)) {
          clearTimeout(activeTimeouts.get(cancelled.id));
          activeTimeouts.delete(cancelled.id);
        }

        saveToHistory(cancelled, "cancelled");
        if (_unregisterNotification) _unregisterNotification(cancelled.id);

        const updatedReminders = reminders.filter(r => r.id !== cancelled.id);
        saveReminders(updatedReminders);

        await reply(`✅ Cancelled reminder: "${cancelled.text}"`);
        return;
      }

      // Check recurring reminders
      const recurring = loadRecurring();
      const userRecurring = recurring.filter(r => r.userId === msg.userId);

      if (!isNaN(num) && num >= 1 && num <= userRecurring.length) {
        cancelled = userRecurring[num - 1];
        isRecurring = true;
      } else {
        cancelled = userRecurring.find(r => r.id === input);
        if (cancelled) isRecurring = true;
      }

      if (cancelled && isRecurring) {
        if (activeTimeouts.has(cancelled.id)) {
          clearTimeout(activeTimeouts.get(cancelled.id));
          activeTimeouts.delete(cancelled.id);
        }

        saveToHistory(cancelled, "cancelled");
        if (_unregisterNotification) _unregisterNotification(cancelled.id);

        const updatedRecurring = recurring.filter(r => r.id !== cancelled.id);
        saveRecurring(updatedRecurring);

        await reply(`✅ Cancelled recurring reminder: "${cancelled.text}"`);
        return;
      }

      await reply(`❌ Reminder "${input}" not found.`);
    },

    every: async (msg, { reply, channels }) => {
      if (!_channels) _channels = channels;

      const input = msg.text.replace(/^\.every\s*/i, "").trim();

      if (!input) {
        await reply("Usage: `.every <time> <text>`\nExample: `.every 10pm are you in bed yet?`\n\nClock formats: `10pm`, `8:30am`, `22:00`");
        return;
      }

      const parts = input.split(/\s+/);
      const timeStr = parts[0];
      const parsed = parseClockTime(timeStr);

      if (!parsed) {
        await reply("❌ Invalid clock time. Use formats like: `10pm`, `8:30am`, `22:00`\n\nExample: `.every 9am drink water`");
        return;
      }

      const text = parts.slice(1).join(" ");
      if (!text) {
        await reply("❌ Please specify what to remind you about.\n\nExample: `.every 10pm are you in bed yet?`");
        return;
      }

      const recurring = {
        id: generateId(),
        userId: msg.userId,
        channelType: msg.channelType,
        channelId: msg.channelId,
        text,
        hour: parsed.hour,
        minute: parsed.minute,
        createdAt: new Date().toISOString(),
      };

      const all = loadRecurring();
      all.push(recurring);
      saveRecurring(all);

      scheduleRecurring(recurring);

      const next = getNextOccurrence(parsed.hour, parsed.minute);
      const delay = next.getTime() - Date.now();

      await reply(`🔁 Recurring reminder set for daily at ${formatClockTime(parsed.hour, parsed.minute)}.\n📝 "${text}"\n⏳ First fire in ${formatDuration(delay)}`);
    },

    recurring: async (msg, { reply }) => {
      const all = loadRecurring().filter(r => r.userId === msg.userId);

      if (all.length === 0) {
        await reply("No active recurring reminders. Use `.every <time> <text>` to set one!");
        return;
      }

      const lines = all.map((r, i) => {
        const next = getNextOccurrence(r.hour, r.minute);
        const delay = next.getTime() - Date.now();
        return `${i + 1}. "${r.text}" — daily at ${formatClockTime(r.hour, r.minute)} (next in ${formatDuration(delay)})`;
      });

      await reply(`🔁 Your recurring reminders:\n\n${lines.join("\n")}\n\nCancel with: \`.cancelreminder <number>\``);
    },

    reminderlog: async (msg, { reply }) => {
      const history = loadHistory().filter(r => r.userId === msg.userId);
      
      if (history.length === 0) {
        await reply("No reminder history yet.");
        return;
      }
      
      // Show last 10 entries
      const recent = history.slice(-10);
      const lines = recent.map(r => {
        const icon = r.status === "completed" ? "✅" : "❌";
        return `${icon} ${formatDate(r.completedAt)}: "${r.text}"`;
      });
      
      await reply(`📋 Reminder history:\n\n${lines.join("\n")}`);
    },
  },

  // Initialize plugin and restore pending reminders on startup
  init: async ({ channels, registerNotification, unregisterNotification }) => {
    _channels = channels;
    _registerNotification = registerNotification || null;
    _unregisterNotification = unregisterNotification || null;
    restoreReminders();
    restoreRecurring();
  },

  // Clean up all active timeouts on shutdown/reload
  destroy: () => {
    for (const timeoutId of activeTimeouts.values()) {
      clearTimeout(timeoutId);
    }
    activeTimeouts.clear();
    console.log("[reminder] Cleared all active timeouts");
  },
};
