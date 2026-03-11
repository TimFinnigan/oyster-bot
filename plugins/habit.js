/**
 * Habit Plugin
 *
 * Visual habit tracker with an emoji grid (GitHub-contribution-style).
 * Each day is a cell: ✅ = done, ❌ = skipped, ⬜ = not logged, ▫️ = future.
 *
 * Commands:
 * - .habit add <name> [emoji]  — register a new habit
 * - .habit log <name>          — mark today as complete
 * - .habit skip <name>         — mark today as skipped/missed
 * - .habit grid [weeks]        — show emoji grid (default 4, max 12)
 * - .habit list                — show all habits with current streaks
 * - .habit remove <name>       — delete a habit and its history
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getDataDir } from "../src/runtime-paths.js";

const DATA_DIR = getDataDir();
const HABITS_FILE = join(DATA_DIR, "habits.json");
const LOG_FILE = join(DATA_DIR, "habit-log.json");

const DEFAULT_EMOJI = "✅";
const DEFAULT_DAYS = 5;
const MAX_DAYS = 30;

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadHabits() {
  try {
    if (existsSync(HABITS_FILE)) {
      const data = JSON.parse(readFileSync(HABITS_FILE, "utf-8"));
      if (Array.isArray(data)) return data;
    }
  } catch (err) {
    console.error("[habit] Failed to load habits:", err.message);
  }
  return [];
}

function saveHabits(habits) {
  ensureDataDir();
  writeFileSync(HABITS_FILE, JSON.stringify(habits, null, 2));
}

function loadLog() {
  try {
    if (existsSync(LOG_FILE)) {
      const data = JSON.parse(readFileSync(LOG_FILE, "utf-8"));
      if (Array.isArray(data)) return data;
    }
  } catch (err) {
    console.error("[habit] Failed to load log:", err.message);
  }
  return [];
}

function saveLog(log) {
  ensureDataDir();
  writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

// ---------------------------------------------------------------------------
// Date helpers (PT timezone, Monday-anchored ISO weeks)
// ---------------------------------------------------------------------------

function todayPT() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

// Add n days to a YYYY-MM-DD date string, returning YYYY-MM-DD.
// Uses noon UTC to stay stable across DST.
function addDays(dateStr, n) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ISO day-of-week: Monday=0, Sunday=6
function isoDayOfWeek(dateStr) {
  const d = new Date(dateStr + "T12:00:00Z");
  return (d.getUTCDay() + 6) % 7;
}

// Monday of the week containing dateStr
function startOfWeek(dateStr) {
  return addDays(dateStr, -isoDayOfWeek(dateStr));
}

function formatDateRange(startStr, endStr) {
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const s = new Date(startStr + "T12:00:00Z");
  const e = new Date(endStr + "T12:00:00Z");
  if (s.getUTCMonth() === e.getUTCMonth()) {
    return `${MONTHS[s.getUTCMonth()]} ${s.getUTCDate()}–${e.getUTCDate()}`;
  }
  return `${MONTHS[s.getUTCMonth()]} ${s.getUTCDate()}–${MONTHS[e.getUTCMonth()]} ${e.getUTCDate()}`;
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

function findHabit(habits, userId, name) {
  return habits.find(
    (h) => h.userId === String(userId) && h.name.toLowerCase() === name.toLowerCase()
  );
}

function userHabits(habits, userId) {
  return habits.filter((h) => h.userId === String(userId));
}

function getLogEntry(log, userId, habitName, date) {
  return log.find(
    (e) =>
      e.userId === String(userId) &&
      e.habitName.toLowerCase() === habitName.toLowerCase() &&
      e.date === date
  );
}

function buildLogMap(log, userId, habitName) {
  const map = new Map();
  for (const e of log) {
    if (
      e.userId === String(userId) &&
      e.habitName.toLowerCase() === habitName.toLowerCase()
    ) {
      map.set(e.date, e.status);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

// Count consecutive "done" days going backwards from today.
// If today isn't logged yet, we start counting from yesterday so the streak
// isn't broken just because the user hasn't logged yet today.
function calcStreak(userId, habitName, log, today) {
  const map = buildLogMap(log, userId, habitName);
  let date = map.get(today) === "done" ? today : addDays(today, -1);
  let streak = 0;
  while (map.get(date) === "done") {
    streak++;
    date = addDays(date, -1);
  }
  return streak;
}

// Completion count over the past N weeks up to and including today.
function calcCompletion(userId, habitName, log, weeks) {
  const today = todayPT();
  const gridStart = addDays(startOfWeek(today), -(weeks - 1) * 7);
  const map = buildLogMap(log, userId, habitName);
  let total = 0;
  let done = 0;
  let date = gridStart;
  while (date <= today) {
    total++;
    if (map.get(date) === "done") done++;
    date = addDays(date, 1);
  }
  return { done, total };
}

// ---------------------------------------------------------------------------
// Grid rendering
// ---------------------------------------------------------------------------

function renderGridRow(userId, habit, days, log) {
  const today = todayPT();
  const map = buildLogMap(log, userId, habit.name);

  const cells = [];
  for (let i = -(days - 1); i <= 0; i++) {
    const date = addDays(today, i);
    const status = map.get(date);
    if (status === "done") cells.push("■");
    else if (status === "skip") cells.push("×");
    else cells.push("□");
  }

  return cells.join(" ");
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export default {
  name: "habit",

  help: {
    habit: "Emoji habit grid tracker. Subcommands: add, log, skip, grid, list, remove",
  },

  commands: {
    habit: async (msg, { reply, claude, sendTyping }) => {
      const input = msg.text.replace(/^\.habit\s*/i, "").trim();
      const parts = input.split(/\s+/);
      const sub = parts[0]?.toLowerCase() || "";
      const rest = parts.slice(1).join(" ").trim();

      const habits = loadHabits();
      const log = loadLog();
      const userId = String(msg.userId);
      const today = todayPT();

      // ── ADD ────────────────────────────────────────────────────────────────
      if (sub === "add") {
        if (!rest) {
          await reply("Usage: `.habit add <name> [emoji]`\nExample: `.habit add meditation 🧘`");
          return;
        }
        const addParts = rest.split(/\s+/);
        const name = addParts[0].toLowerCase();
        const emoji = addParts.length > 1 ? addParts.slice(1).join(" ") : DEFAULT_EMOJI;

        if (findHabit(habits, userId, name)) {
          await reply(`❌ Habit "${name}" already exists. Use \`.habit list\` to see yours.`);
          return;
        }

        habits.push({ userId, name, emoji, createdAt: today });
        saveHabits(habits);
        await reply(`✅ Habit "${name}" ${emoji} added!\nLog it daily with \`.habit log ${name}\``);
        return;
      }

      // ── LOG ────────────────────────────────────────────────────────────────
      if (sub === "log") {
        const myHabits = userHabits(habits, userId);

        if (!rest) {
          if (myHabits.length === 0) {
            await reply("No habits yet. Start with `.habit add <name>`");
            return;
          }
          const lines = myHabits.map((h, i) => {
            const done = getLogEntry(log, userId, h.name, today)?.status === "done";
            return `${i + 1}. ${h.name}${done ? " ✅" : ""}`;
          });
          await reply(`Log which habits?\n\n${lines.join("\n")}\n\nReply: \`.habit log 1 2\``);
          return;
        }

        // Resolve args: numbers → habit by index, otherwise treat as name
        const args = rest.split(/\s+/);
        const allNums = args.every((a) => /^\d+$/.test(a));
        let targets;
        if (allNums) {
          targets = args.map((a) => {
            const idx = parseInt(a, 10) - 1;
            return myHabits[idx] || null;
          });
          const invalid = args.filter((a, i) => !targets[i]);
          if (invalid.length) {
            await reply(`❌ No habit at position${invalid.length > 1 ? "s" : ""}: ${invalid.join(", ")}. Use \`.habit list\` to see your habits.`);
            return;
          }
        } else {
          const habit = findHabit(habits, userId, rest.toLowerCase());
          if (!habit) {
            await reply(`❌ Habit "${rest}" not found. Use \`.habit list\` to see yours.`);
            return;
          }
          targets = [habit];
        }

        const results = [];
        for (const habit of targets) {
          const existing = getLogEntry(log, userId, habit.name, today);
          if (existing) {
            const label = existing.status === "done" ? "already logged" : "already skipped";
            results.push(`${habit.name} — ${label}`);
            continue;
          }
          log.push({ userId, habitName: habit.name, date: today, status: "done", loggedAt: new Date().toISOString() });
          const streak = calcStreak(userId, habit.name, log, today);
          const streakMsg = streak > 1 ? ` 🔥 ${streak}d` : "";
          results.push(`✅ ${habit.name}${streakMsg}`);
        }
        saveLog(log);
        await reply(results.join("\n"));
        return;
      }

      // ── SKIP ───────────────────────────────────────────────────────────────
      if (sub === "skip") {
        const name = rest.toLowerCase();
        if (!name) {
          await reply("Usage: `.habit skip <name>`");
          return;
        }

        const habit = findHabit(habits, userId, name);
        if (!habit) {
          await reply(`❌ Habit "${name}" not found. Use \`.habit list\` to see yours.`);
          return;
        }

        const existing = getLogEntry(log, userId, name, today);
        if (existing) {
          if (existing.status === "skip") {
            await reply(`${habit.emoji} "${name}" already marked as skipped for today.`);
          } else {
            existing.status = "skip";
            saveLog(log);
            await reply(`❌ "${name}" updated to skipped for today.`);
          }
          return;
        }

        log.push({ userId, habitName: name, date: today, status: "skip", loggedAt: new Date().toISOString() });
        saveLog(log);
        await reply(`❌ "${name}" marked as skipped for ${today}.`);
        return;
      }

      // ── GRID ───────────────────────────────────────────────────────────────
      if (sub === "grid" || sub === "") {
        const myHabits = userHabits(habits, userId);
        if (myHabits.length === 0) {
          await reply("No habits yet. Start with `.habit add <name> [emoji]`");
          return;
        }

        const daysArg = parseInt(rest, 10);
        const days = !isNaN(daysArg) && daysArg >= 1 ? Math.min(daysArg, MAX_DAYS) : DEFAULT_DAYS;

        await sendTyping();

        const rows = myHabits.map((habit) => {
          const cells = renderGridRow(userId, habit, days, log);
          const streak = calcStreak(userId, habit.name, log, today);
          const streakStr = streak > 0 ? ` 🔥${streak}d` : "";
          return `${cells}  ${habit.name}${streakStr}`;
        });

        let message = "```\n\n" + rows.join("\n") + "\n```";

        await reply(message);
        return;
      }

      // ── LIST ───────────────────────────────────────────────────────────────
      if (sub === "list") {
        const myHabits = userHabits(habits, userId);
        if (myHabits.length === 0) {
          await reply("No habits yet. Start with `.habit add <name> [emoji]`");
          return;
        }

        const lines = myHabits.map((h, i) => {
          const done = getLogEntry(log, userId, h.name, today)?.status === "done";
          return done ? `${i + 1}. ${h.name} ✅` : `${i + 1}. ${h.name}`;
        });
        await reply(lines.join("\n"));
        return;
      }

      // ── REMOVE ─────────────────────────────────────────────────────────────
      if (sub === "remove") {
        const name = rest.toLowerCase();
        if (!name) {
          await reply("Usage: `.habit remove <name>`");
          return;
        }

        const habit = findHabit(habits, userId, name);
        if (!habit) {
          await reply(`❌ Habit "${name}" not found.`);
          return;
        }

        saveHabits(habits.filter((h) => !(h.userId === userId && h.name.toLowerCase() === name)));
        saveLog(log.filter((e) => !(e.userId === userId && e.habitName.toLowerCase() === name)));
        await reply(`🗑️ Habit "${name}" and all its history removed.`);
        return;
      }

      // ── HELP ───────────────────────────────────────────────────────────────
      await reply(
        "🌱 Habit Tracker\n\n" +
        "`.habit add <name> [emoji]` — register a habit\n" +
        "`.habit log <name>` — mark today as done\n" +
        "`.habit skip <name>` — mark today as skipped\n" +
        "`.habit grid [days]` — show emoji grid (default 5, max 30)\n" +
        "`.habit list` — show habits and streaks\n" +
        "`.habit remove <name>` — delete a habit and its history"
      );
    },
  },

  schedules: [
    {
      // 7pm PT. Override with HABIT_REMINDER_CRON.
      cron: process.env.HABIT_REMINDER_CRON || "0 19 * * *",

      handler: async ({ channels, config }) => {
        const targetChatId = config.plugins?.targetChatId;
        const targetChannel = config.plugins?.targetChannel || "telegram";
        if (!targetChatId) return;

        const channel = channels.get(targetChannel);
        if (!channel) return;

        const userId = String(targetChatId);
        const myHabits = userHabits(loadHabits(), userId);
        if (myHabits.length === 0) return;

        const log = loadLog();
        const today = todayPT();

        const pending = myHabits.filter((h) => !getLogEntry(log, userId, h.name, today));
        if (pending.length === 0) return;

        const lines = pending.map((h) => h.name);
        await channel.send(userId, `🌅 Habits left for today:\n\n${lines.join("\n")}`);
        console.log(`[habit] Sent reminder for ${pending.length} unlogged habit(s)`);
      },
    },
  ],
};
