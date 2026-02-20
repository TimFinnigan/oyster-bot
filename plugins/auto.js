/**
 * Auto Plugin
 *
 * Schedule any other plugin command to run on a simple repeating interval.
 *
 * Commands:
 * - .auto add <interval> <command>
 *     e.g. ".auto add 4h .feature"
 *           ".auto add 1d .feature do 12"
 *     Supported intervals: 30s, 5m, 2h, 1d
 *
 * - .auto list
 *     Shows all active automations (IDs, interval, next run, command)
 *
 * - .auto remove <id>
 *     Deletes an automation by its ID
 *
 * - .auto run <id>
 *     Triggers an automation immediately (still keeps the schedule)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getDataDir } from "../src/runtime-paths.js";
import { handlePluginMessage } from "../src/plugin-loader.js";

const DATA_DIR = getDataDir();
const TASKS_FILE = join(DATA_DIR, "auto-tasks.json");

let tasks = [];
const timers = new Map();
let _channels = null;

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadTasks() {
  try {
    if (existsSync(TASKS_FILE)) {
      const data = JSON.parse(readFileSync(TASKS_FILE, "utf-8"));
      if (Array.isArray(data)) return data;
    }
  } catch (err) {
    console.error("[auto] Failed to load tasks:", err.message);
  }
  return [];
}

function saveTasks() {
  try {
    ensureDataDir();
    writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
  } catch (err) {
    console.error("[auto] Failed to save tasks:", err.message);
  }
}

function generateId() {
  return Math.random().toString(36).slice(2, 8);
}

function parseInterval(input) {
  const match = input.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value * multipliers[unit];
}

function formatInterval(ms) {
  if (ms % 86400000 === 0) return `${ms / 86400000}d`;
  if (ms % 3600000 === 0) return `${ms / 3600000}h`;
  if (ms % 60000 === 0) return `${ms / 60000}m`;
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}

function scheduleTask(task) {
  const existing = timers.get(task.id);
  if (existing) clearTimeout(existing);

  const now = Date.now();
  if (!task.nextRun || task.nextRun < now) {
    task.nextRun = now + task.intervalMs;
  }
  const delay = Math.max(task.nextRun - now, 1000);

  const timer = setTimeout(() => runTask(task), delay);
  timers.set(task.id, timer);
}

async function runTask(task) {
  const channel = _channels?.get(task.channelType);
  const identifier = `'${task.command}' (auto:${task.id})`;

  if (channel) {
    try {
      await channel.send(task.channelId, `🤖 Auto-running ${identifier}`);
    } catch (err) {
      console.error("[auto] Failed to send pre-run message:", err.message);
    }
  }

  const syntheticMsg = {
    text: task.command,
    userId: task.userId,
    channelId: task.channelId,
    channelType: task.channelType,
  };

  try {
    const handled = await handlePluginMessage(syntheticMsg);
    if (!handled) {
      await channel?.send(task.channelId, `⚠️ Auto command ${identifier} not handled by any plugin.`);
    }
  } catch (err) {
    console.error("[auto] Command error:", err.message);
    await channel?.send(task.channelId, `❌ Auto command ${identifier} failed: ${err.message.slice(0, 200)}`);
  } finally {
    task.lastRun = new Date().toISOString();
    task.nextRun = Date.now() + task.intervalMs;
    saveTasks();
    scheduleTask(task);
  }
}

function removeTask(id) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  tasks = tasks.filter((t) => t.id !== id);
  saveTasks();
}

function describeTask(task, index = null) {
  const parts = [];
  if (index !== null) parts.push(`${index + 1}.`);
  parts.push(`[${task.id}] every ${formatInterval(task.intervalMs)} — ${task.command}`);
  if (task.nextRun) {
    const eta = Math.max(task.nextRun - Date.now(), 0);
    const mins = Math.round(eta / 60000);
    parts.push(`(next in ~${mins}m)`);
  }
  return parts.join(" ");
}

function resolveTaskByToken(token) {
  if (!token) return null;
  const byId = tasks.find((t) => t.id === token);
  if (byId) return byId;
  if (/^\d+$/.test(token)) {
    const idx = parseInt(token, 10) - 1;
    if (idx >= 0 && idx < tasks.length) {
      return tasks[idx];
    }
  }
  return null;
}

export default {
  name: "auto",

  help: {
    auto: "Automate another command. Usage: .auto add <interval> <command> | .auto list | .auto remove <id|number> | .auto run <id|number>",
  },

  commands: {
    auto: async (msg, { reply }) => {
      const input = msg.text.replace(/^\.auto\s*/i, "").trim();
      if (!input) {
        await reply(
          "Usage:\n" +
          "• `.auto add 4h .feature`\n" +
          "• `.auto list`\n" +
          "• `.auto remove <id|number>`\n" +
          "• `.auto run <id|number>`"
        );
        return;
      }

      const [sub, ...rest] = input.split(/\s+/);
      const lowerSub = sub.toLowerCase();

      if (lowerSub === "list") {
        if (tasks.length === 0) {
          await reply("No automations configured. Add one with `.auto add 1d .feature`.");
          return;
        }
        const lines = ["🤖 Auto Tasks:"];
        tasks.forEach((task, idx) => lines.push(describeTask(task, idx)));
        await reply(lines.join("\n"));
        return;
      }

      if (lowerSub === "add") {
        if (rest.length < 2) {
          await reply("Usage: `.auto add <interval> <command>` (e.g., `.auto add 6h .feature`)");
          return;
        }
        const intervalStr = rest[0];
        const intervalMs = parseInterval(intervalStr);
        if (!intervalMs || intervalMs < 15000) {
          await reply("Invalid interval. Use formats like `30m`, `4h`, `1d` (minimum 15s).");
          return;
        }
        const commandText = rest.slice(1).join(" ").trim();
        if (!commandText.startsWith(".")) {
          await reply("Auto command must start with a plugin command (e.g., `.feature`).");
          return;
        }

        const newTask = {
          id: generateId(),
          intervalMs,
          command: commandText,
          userId: msg.userId,
          channelId: msg.channelId,
          channelType: msg.channelType,
          createdAt: new Date().toISOString(),
          lastRun: null,
          nextRun: Date.now() + intervalMs,
        };
        tasks.push(newTask);
        saveTasks();
        scheduleTask(newTask);
        await reply(`✅ Scheduled auto task ${describeTask(newTask)}.`);
        return;
      }

      if (lowerSub === "remove") {
        const token = rest[0];
        if (!token) {
          await reply("Usage: `.auto remove <id|number>`");
          return;
        }
        const task = resolveTaskByToken(token);
        if (!task) {
          await reply(`Task ${token} not found. Use \`.auto list\` to see valid entries.`);
          return;
        }
        removeTask(task.id);
        await reply(`🗑️ Removed auto task ${task.id}.`);
        return;
      }

      if (lowerSub === "run") {
        const token = rest[0];
        if (!token) {
          await reply("Usage: `.auto run <id|number>`");
          return;
        }
        const task = resolveTaskByToken(token);
        if (!task) {
          await reply(`Task ${token} not found. Use \`.auto list\` to see valid entries.`);
          return;
        }
        await reply(`⏱️ Triggering auto task ${task.id} now...`);
        await runTask(task);
        return;
      }

      await reply("Unknown subcommand. Use `.auto add`, `.auto list`, `.auto remove`, or `.auto run`.");
    },
  },

  init: async ({ channels }) => {
    _channels = channels;
    tasks = loadTasks();
    tasks.forEach((task) => scheduleTask(task));
    console.log(`[auto] Loaded ${tasks.length} task(s)`);
  },

  destroy: () => {
    for (const timer of timers.values()) {
      clearTimeout(timer);
    }
    timers.clear();
  },
};
