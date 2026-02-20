/**
 * Day Planner Plugin
 *
 * Manage a daily task list with optional times, priorities, and durations.
 *
 * Commands:
 * - .plan today <task1>, <task2> ...   — Set (replace) today's plan
 * - .plan show                         — View today's plan
 * - .plan add <task>                   — Append a task to today's plan
 * - .plan done <number>                — Mark a task complete
 * - .plan clear                        — Clear today's plan
 *
 * Task syntax (all tags optional):
 *   Buy groceries @3pm #high (45m)
 *   @time   : @9am, @2:30pm, @14:00
 *   #priority: #high, #med, #low
 *   (duration): (30m), (1h), (90m)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getDataDir } from "../src/runtime-paths.js";

const DATA_DIR = getDataDir();
const PLANS_FILE = join(DATA_DIR, "plans.json");

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadPlans() {
  try {
    if (existsSync(PLANS_FILE)) {
      const data = JSON.parse(readFileSync(PLANS_FILE, "utf-8"));
      if (data && typeof data === "object") return data;
    }
  } catch (err) {
    console.error("[day_planner] Failed to load plans:", err.message);
  }
  return {};
}

function savePlans(plans) {
  try {
    ensureDataDir();
    writeFileSync(PLANS_FILE, JSON.stringify(plans, null, 2));
  } catch (err) {
    console.error("[day_planner] Failed to save plans:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function todayKey() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }); // YYYY-MM-DD in PT
}

function planKey(userId) {
  return `${userId}:${todayKey()}`;
}

// ---------------------------------------------------------------------------
// Task parsing
// ---------------------------------------------------------------------------

/**
 * Parse a clock time string like "9am", "2:30pm", "14:00" → { hour, minute }
 * Returns null if not a valid time string.
 */
function parseClockTime(str) {
  const match12 = str.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/i);
  if (match12) {
    let hour = parseInt(match12[1], 10);
    const minute = match12[2] ? parseInt(match12[2], 10) : 0;
    const period = match12[3].toLowerCase();
    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
    if (period === "am" && hour === 12) hour = 0;
    else if (period === "pm" && hour !== 12) hour += 12;
    return { hour, minute };
  }
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
 * Parse duration string like "30m", "1h", "90m" → minutes
 * Returns null if not a valid duration.
 */
function parseDuration(str) {
  const match = str.match(/^(\d+)(m|h)$/i);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  return match[2].toLowerCase() === "h" ? value * 60 : value;
}

const PRIORITY_VALUES = { high: 1, med: 2, low: 3 };

/**
 * Parse a raw task string into a structured task object.
 * Tags (@time, #priority, (duration)) are extracted and removed from the label.
 */
function parseTask(raw) {
  let text = raw.trim();
  let time = null;
  let priority = null;
  let durationMins = null;

  // Extract @time
  text = text.replace(/@(\S+)/g, (_, token) => {
    const parsed = parseClockTime(token);
    if (parsed && !time) {
      time = parsed;
      return "";
    }
    return `@${token}`;
  });

  // Extract #priority
  text = text.replace(/#(\w+)/g, (_, token) => {
    const lower = token.toLowerCase();
    if (lower in PRIORITY_VALUES && !priority) {
      priority = lower;
      return "";
    }
    return `#${token}`;
  });

  // Extract (duration)
  text = text.replace(/\((\w+)\)/g, (_, token) => {
    const mins = parseDuration(token);
    if (mins !== null && !durationMins) {
      durationMins = mins;
      return "";
    }
    return `(${token})`;
  });

  const label = text.replace(/\s+/g, " ").trim();
  if (!label) return null;

  return { label, time, priority, durationMins, done: false };
}

/**
 * Split a comma-separated task list, respecting that commas inside
 * parentheses should not split (e.g., "(1h, 30m)" — unlikely but safe).
 */
function splitTasks(input) {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatTime(time) {
  if (!time) return null;
  const period = time.hour >= 12 ? "pm" : "am";
  const h = time.hour === 0 ? 12 : time.hour > 12 ? time.hour - 12 : time.hour;
  const m = time.minute ? `:${String(time.minute).padStart(2, "0")}` : "";
  return `${h}${m}${period}`;
}

function formatDuration(mins) {
  if (mins === null) return null;
  if (mins % 60 === 0) return `${mins / 60}h`;
  if (mins >= 60) return `${Math.floor(mins / 60)}h${mins % 60}m`;
  return `${mins}m`;
}

const PRIORITY_ICONS = { high: "🔴", med: "🟡", low: "🟢" };

function formatTask(task, index, total) {
  const check = task.done ? "✅" : "⬜";
  const label = task.done ? `~~${task.label}~~` : task.label;
  let line = `${check} ${index + 1}. ${label}`;

  const meta = [];
  if (task.time) meta.push(`🕐 ${formatTime(task.time)}`);
  if (task.durationMins !== null) meta.push(`⏱ ${formatDuration(task.durationMins)}`);
  if (task.priority) meta.push(PRIORITY_ICONS[task.priority]);

  if (meta.length) line += `  ${meta.join("  ")}`;
  return line;
}

/**
 * Group tasks into time sections for .plan show
 */
function buildAgenda(tasks) {
  const sections = {
    Flexible: [],  // no time
    Morning: [],   // 5–11:59
    Afternoon: [], // 12–16:59
    Evening: [],   // 17–23:59
  };

  tasks.forEach((task, idx) => {
    const entry = { task, idx };
    if (!task.time) {
      sections.Flexible.push(entry);
    } else if (task.time.hour < 12) {
      sections.Morning.push(entry);
    } else if (task.time.hour < 17) {
      sections.Afternoon.push(entry);
    } else {
      sections.Evening.push(entry);
    }
  });

  // Sort timed sections chronologically
  for (const key of ["Morning", "Afternoon", "Evening"]) {
    sections[key].sort((a, b) => {
      const ta = a.task.time.hour * 60 + a.task.time.minute;
      const tb = b.task.time.hour * 60 + b.task.time.minute;
      return ta - tb;
    });
  }

  return sections;
}

function renderPlan(tasks) {
  if (tasks.length === 0) return "No tasks planned for today. Add some with `.plan add <task>`.";

  const sections = buildAgenda(tasks);
  const sectionIcons = { Morning: "🌅", Afternoon: "☀️", Evening: "🌙", Flexible: "📌" };

  const lines = [`📆  ${todayKey()}`];

  for (const [name, entries] of Object.entries(sections)) {
    if (entries.length === 0) continue;
    lines.push(`\n${sectionIcons[name]}  ${name.toUpperCase()}\n`);
    for (const { task, idx } of entries) {
      lines.push(`   ${formatTask(task, idx, tasks.length)}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export default {
  name: "day_planner",

  help: {
    plan: "Manage your daily task plan. Usage: .plan today <tasks> | .plan show | .plan add <task> | .plan insert <n> <task> | .plan done <n> | .plan clear",
  },

  commands: {
    plan: async (msg, { reply }) => {
      const input = msg.text.replace(/^\.plan\s*/i, "").trim();

      if (!input || input.toLowerCase() === "show") {
        const plans = loadPlans();
        const tasks = plans[planKey(msg.userId)] ?? [];
        await reply(renderPlan(tasks));
        return;
      }

      const [sub, ...rest] = input.split(/\s+/);
      const lowerSub = sub.toLowerCase();

      // .plan today <task1>, <task2>, ...
      if (lowerSub === "today") {
        const raw = rest.join(" ").trim();
        if (!raw) {
          await reply("Usage: `.plan today <task1>, <task2>, ...`\nExample: `.plan today Email client @9am #high, Lunch @12pm (1h), Review PR`");
          return;
        }
        const tasks = splitTasks(raw).map(parseTask).filter(Boolean);
        if (tasks.length === 0) {
          await reply("❌ Couldn't parse any tasks. Try: `.plan today Buy groceries @3pm #high, Read 30m`");
          return;
        }
        const plans = loadPlans();
        plans[planKey(msg.userId)] = tasks;
        savePlans(plans);
        await reply(`✅ Plan set with ${tasks.length} task(s).\n\n${renderPlan(tasks)}`);
        return;
      }

      // .plan add <task>
      if (lowerSub === "add") {
        const raw = rest.join(" ").trim();
        if (!raw) {
          await reply("Usage: `.plan add <task>`\nExample: `.plan add Call dentist @4pm`");
          return;
        }
        const task = parseTask(raw);
        if (!task) {
          await reply("❌ Couldn't parse task. Make sure it has a description.");
          return;
        }
        const plans = loadPlans();
        const key = planKey(msg.userId);
        if (!plans[key]) plans[key] = [];
        plans[key].push(task);
        savePlans(plans);
        await reply(`✅ Added: ${formatTask(task, plans[key].length - 1)}`);
        return;
      }

      // .plan insert <number> <task>
      if (lowerSub === "insert") {
        const numStr = rest[0];
        const num = parseInt(numStr, 10);
        const raw = rest.slice(1).join(" ").trim();

        const plans = loadPlans();
        const key = planKey(msg.userId);
        const tasks = plans[key] ?? [];

        if (!raw) {
          await reply("Usage: `.plan insert <number> <task>`\nExample: `.plan insert 3 Call dentist @4pm`");
          return;
        }
        if (isNaN(num) || num < 1 || num > tasks.length + 1) {
          await reply(`❌ Invalid position. Use a number between 1 and ${tasks.length + 1}.`);
          return;
        }
        const task = parseTask(raw);
        if (!task) {
          await reply("❌ Couldn't parse task. Make sure it has a description.");
          return;
        }
        tasks.splice(num - 1, 0, task);
        plans[key] = tasks;
        savePlans(plans);
        await reply(`✅ Inserted at position ${num}.\n\n${renderPlan(tasks)}`);
        return;
      }

      // .plan done <number>
      if (lowerSub === "done") {
        const numStr = rest[0];
        const num = parseInt(numStr, 10);
        const plans = loadPlans();
        const key = planKey(msg.userId);
        const tasks = plans[key] ?? [];

        if (isNaN(num) || num < 1 || num > tasks.length) {
          await reply(`❌ Invalid task number. Use a number between 1 and ${tasks.length}.`);
          return;
        }
        tasks[num - 1].done = true;
        plans[key] = tasks;
        savePlans(plans);
        const done = tasks.filter((t) => t.done).length;
        await reply(`✅ Marked task ${num} done. (${done}/${tasks.length} complete)\n\n${renderPlan(tasks)}`);
        return;
      }

      // .plan clear
      if (lowerSub === "clear") {
        const plans = loadPlans();
        delete plans[planKey(msg.userId)];
        savePlans(plans);
        await reply("🗑️ Today's plan cleared.");
        return;
      }

      await reply("Unknown subcommand. Use `.plan today`, `.plan show`, `.plan add`, `.plan done`, or `.plan clear`.");
    },
  },
};
