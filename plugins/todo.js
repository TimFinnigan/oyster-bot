/**
 * Todo Plugin
 *
 * Append items to a todo list and view them.
 * - .todo <item> — Add a todo item
 * - .todo — Prompts you to enter a todo item
 * - .todos — View your todo list
 * - .done <number> — Mark a todo as done and remove it
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { getDataDir } from "../src/runtime-paths.js";

const TODO_FILE = join(getDataDir(), "todos.json");

const waitingForTodo = new Set();

function getUserKey(msg) {
  return `${msg.channelType}:${msg.userId}`;
}

function ensureDataDir() {
  const dataDir = dirname(TODO_FILE);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}

function loadTodos() {
  try {
    if (existsSync(TODO_FILE)) {
      return JSON.parse(readFileSync(TODO_FILE, "utf-8"));
    }
  } catch (err) {
    console.error("[todo] Error loading todos:", err.message);
  }
  return [];
}

function saveTodos(todos) {
  ensureDataDir();
  writeFileSync(TODO_FILE, JSON.stringify(todos, null, 2));
}

function addTodo(userId, channelType, text) {
  const todos = loadTodos();
  todos.push({
    userId,
    channelType,
    text,
    createdAt: new Date().toISOString(),
  });
  saveTodos(todos);
}

export default {
  name: "todo",

  help: {
    todo: "Add a todo item",
    todos: "View your todo list",
    done: "Mark a todo as done (e.g., .done 1)",
  },

  commands: {
    todo: async (msg, { reply }) => {
      const userKey = getUserKey(msg);
      const text = msg.text.replace(/^\.todo\s*/i, "").trim();

      if (text) {
        addTodo(msg.userId, msg.channelType, text);
        await reply(`Added: ${text}`);
      } else {
        waitingForTodo.add(userKey);
        await reply("What do you want to add? (Send your response)");
      }
    },

    todos: async (msg, { reply }) => {
      const todos = loadTodos().filter((t) => t.userId === msg.userId);

      if (todos.length === 0) {
        await reply("No todos yet. Use .todo to add one!");
        return;
      }

      const lines = todos.map((t, i) => `${i + 1}. ${t.text}`);
      await reply(`Your todos:\n\n${lines.join("\n")}`);
    },

    done: async (msg, { reply }) => {
      const arg = msg.text.replace(/^\.done\s*/i, "").trim();
      const index = parseInt(arg, 10);

      if (!arg || isNaN(index) || index < 1) {
        await reply("Usage: .done <number> (e.g. .done 1)");
        return;
      }

      const allTodos = loadTodos();
      const userTodos = allTodos.filter((t) => t.userId === msg.userId);

      if (index > userTodos.length) {
        await reply(`You only have ${userTodos.length} todo(s).`);
        return;
      }

      const removed = userTodos[index - 1];
      const globalIndex = allTodos.indexOf(removed);
      allTodos.splice(globalIndex, 1);
      saveTodos(allTodos);

      await reply(`Done: ${removed.text}`);
    },
  },

  onMessage: async (msg, { reply }) => {
    const userKey = getUserKey(msg);

    if (waitingForTodo.has(userKey)) {
      waitingForTodo.delete(userKey);
      const text = msg.text.trim();

      if (text) {
        addTodo(msg.userId, msg.channelType, text);
        await reply(`Added: ${text}`);
        return true;
      }
    }
    return false;
  },
};
