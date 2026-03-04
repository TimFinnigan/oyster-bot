/**
 * Reflection Plugin
 *
 * Sends a unique daily reflection prompt to encourage self-exploration.
 * Uses a static prompt bank (50+ prompts across 5 categories) with per-user
 * history tracking to ensure no repeats until all prompts are exhausted.
 *
 * Commands:
 * - .reflect                          — get a reflection prompt now
 * - .reflect categories               — show enabled/disabled categories
 * - .reflect enable <category>        — enable a category
 * - .reflect disable <category>       — disable a category
 *
 * Schedule: daily at 9am PT by default. Override with REFLECTION_CRON env var.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getDataDir } from "../src/runtime-paths.js";
import { isPluginEnabled } from "../src/plugin-settings.js";

const DATA_DIR = getDataDir();
const HISTORY_FILE = join(DATA_DIR, "reflection-history.json");
const STATE_FILE = join(DATA_DIR, "reflection-state.json");

let _config = null;

// ---------------------------------------------------------------------------
// Prompt bank
// ---------------------------------------------------------------------------

const PROMPTS = [
  // values
  { id: "v1",  category: "values",        text: "What's one value you hold that most people around you don't share? Where did it come from?" },
  { id: "v2",  category: "values",        text: "When did you last compromise on something important to you? Would you make the same choice again?" },
  { id: "v3",  category: "values",        text: "What does integrity look like in your daily life, not just in big moments?" },
  { id: "v4",  category: "values",        text: "If you had to teach someone your most important value without naming it, what would you show them?" },
  { id: "v5",  category: "values",        text: "What's something you believe strongly that you rarely say out loud?" },
  { id: "v6",  category: "values",        text: "What do you spend money on that tells the truest story of what you value?" },
  { id: "v7",  category: "values",        text: "Think of a decision you made purely from instinct. What value was driving it?" },
  { id: "v8",  category: "values",        text: "What would you refuse to do for any amount of money?" },
  { id: "v9",  category: "values",        text: "What's a belief you used to hold that you've completely reversed?" },
  { id: "v10", category: "values",        text: "If your calendar and bank statement are honest diaries — what story do they tell about your values?" },

  // identity
  { id: "i1",  category: "identity",      text: "Who are you when no one is watching and nothing is expected of you?" },
  { id: "i2",  category: "identity",      text: "What role do you play in other people's stories — and is that who you actually are?" },
  { id: "i3",  category: "identity",      text: "What part of yourself have you hidden most of your life, and why?" },
  { id: "i4",  category: "identity",      text: "What would younger you think of who you've become?" },
  { id: "i5",  category: "identity",      text: "What labels do you use to describe yourself that might be limiting you?" },
  { id: "i6",  category: "identity",      text: "What's something you've never admitted to anyone that feels deeply true about you?" },
  { id: "i7",  category: "identity",      text: "Where in your life are you performing a version of yourself rather than being yourself?" },
  { id: "i8",  category: "identity",      text: "What would you do differently if you knew no one would ever find out?" },
  { id: "i9",  category: "identity",      text: "What part of your personality did you used to suppress that you've since let out?" },
  { id: "i10", category: "identity",      text: "If you had to describe yourself using only verbs — not nouns or adjectives — what would they be?" },

  // creativity
  { id: "c1",  category: "creativity",    text: "What would you make if you knew no one would ever see it?" },
  { id: "c2",  category: "creativity",    text: "What's an idea you've been sitting on for years that still won't leave you alone?" },
  { id: "c3",  category: "creativity",    text: "When do you feel most creatively alive — and what conditions produce that feeling?" },
  { id: "c4",  category: "creativity",    text: "What would you build, write, or create if failure were guaranteed but it didn't matter?" },
  { id: "c5",  category: "creativity",    text: "What's something broken in the world that you secretly think you could fix?" },
  { id: "c6",  category: "creativity",    text: "What creative work from someone else made you feel both inspired and a little jealous?" },
  { id: "c7",  category: "creativity",    text: "When was the last time you surprised yourself with something you made or figured out?" },
  { id: "c8",  category: "creativity",    text: "What problem do you find yourself mentally solving over and over, uninvited?" },
  { id: "c9",  category: "creativity",    text: "If you had a year with no obligations and unlimited resources, what would you create?" },
  { id: "c10", category: "creativity",    text: "What medium — writing, building, music, code, cooking, whatever — feels closest to your natural language?" },

  // relationships
  { id: "r1",  category: "relationships", text: "Who in your life do you take for granted? What would it look like to stop?" },
  { id: "r2",  category: "relationships", text: "What's something important you've never said to someone who deserves to hear it?" },
  { id: "r3",  category: "relationships", text: "Who brings out the best version of you — and what is it about them that does that?" },
  { id: "r4",  category: "relationships", text: "What kind of friend, partner, or family member do you wish you were better at being?" },
  { id: "r5",  category: "relationships", text: "When did someone's honesty with you change your life, even if it stung at the time?" },
  { id: "r6",  category: "relationships", text: "What relationship in your past still shapes how you show up in current ones?" },
  { id: "r7",  category: "relationships", text: "Where in your relationships do you give what's easy instead of what's needed?" },
  { id: "r8",  category: "relationships", text: "Who do you wish knew you better — and what's stopped you from letting them?" },
  { id: "r9",  category: "relationships", text: "What would it mean to love someone without needing anything back from them?" },
  { id: "r10", category: "relationships", text: "What's a conflict you've been avoiding that would actually bring you closer if you faced it?" },

  // growth
  { id: "g1",  category: "growth",        text: "What's a hard thing you've been through that you wouldn't undo, even if you could?" },
  { id: "g2",  category: "growth",        text: "What's one habit or pattern you keep returning to that you know isn't serving you?" },
  { id: "g3",  category: "growth",        text: "What are you currently avoiding that, deep down, you know is the next step?" },
  { id: "g4",  category: "growth",        text: "What does your most courageous self look like — and how far are you from that person right now?" },
  { id: "g5",  category: "growth",        text: "What's a story you tell about yourself that might be keeping you stuck?" },
  { id: "g6",  category: "growth",        text: "What's the most useful piece of feedback you've ever received that you resisted at first?" },
  { id: "g7",  category: "growth",        text: "What would you do differently in the last year if you could go back — not to fix mistakes, but to be more yourself?" },
  { id: "g8",  category: "growth",        text: "What fear is dressed up as a practical reason in your life right now?" },
  { id: "g9",  category: "growth",        text: "What's something you've outgrown but haven't let go of yet?" },
  { id: "g10", category: "growth",        text: "If the version of you from five years ago could see you now, what would surprise them most?" },
];

const ALL_CATEGORIES = ["values", "identity", "creativity", "relationships", "growth"];

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadHistory() {
  try {
    if (existsSync(HISTORY_FILE)) {
      const data = JSON.parse(readFileSync(HISTORY_FILE, "utf-8"));
      if (data && typeof data === "object") return data;
    }
  } catch (err) {
    console.error("[reflection] Failed to load history:", err.message);
  }
  return {};
}

function saveHistory(history) {
  ensureDataDir();
  writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

function loadState() {
  try {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {}
  return {};
}

function saveState(state) {
  ensureDataDir();
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function todayPT() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

async function sendReflection(channel, channelId, userId) {
  if (_config && !isPluginEnabled("reflection", userId, _config)) {
    console.log("[reflection] Plugin disabled for user, skipping");
    return;
  }
  const text = getReflection(userId);
  await channel.send(channelId, `🪞 ${text}`);
  saveState({ lastReflectionDate: todayPT() });
  console.log("[reflection] Sent scheduled reflection");
}

function scheduleRandomReflection(channel, channelId, userId) {
  const state = loadState();
  if (state.lastReflectionDate === todayPT()) {
    console.log("[reflection] Already sent today, skipping");
    return;
  }

  const now = new Date();
  const ptTime = now.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric", minute: "numeric", hour12: false,
  });
  const [ptHour, ptMinute] = ptTime.split(":").map(Number);
  const ptMinuteOfDay = ptHour * 60 + ptMinute;

  const startMinute = 9 * 60;  // 9am PT
  const endMinute   = 20 * 60; // 8pm PT

  if (ptMinuteOfDay >= endMinute) {
    console.log("[reflection] Past 8pm PT, skipping today");
    return;
  }

  const windowMinutes = endMinute - Math.max(ptMinuteOfDay, startMinute);
  const delayMs = Math.floor(Math.random() * windowMinutes * 60 * 1000);

  console.log(`[reflection] Random reflection in ${Math.round(delayMs / 60000)}m`);
  setTimeout(() => sendReflection(channel, channelId, userId), delayMs);
}

function getUserState(history, userId) {
  if (!history[userId]) {
    history[userId] = { seen: [], categories: [...ALL_CATEGORIES] };
  }
  // Backfill categories if missing
  if (!history[userId].categories) {
    history[userId].categories = [...ALL_CATEGORIES];
  }
  return history[userId];
}

// ---------------------------------------------------------------------------
// Prompt selection
// ---------------------------------------------------------------------------

function pickPrompt(userId) {
  const history = loadHistory();
  const state = getUserState(history, userId);

  const available = PROMPTS.filter(
    (p) => state.categories.includes(p.category) && !state.seen.includes(p.id)
  );

  // Reset seen list if all eligible prompts have been shown
  if (available.length === 0) {
    state.seen = [];
    const reset = PROMPTS.filter((p) => state.categories.includes(p.category));
    if (reset.length === 0) return null;
    const picked = reset[Math.floor(Math.random() * reset.length)];
    state.seen.push(picked.id);
    saveHistory(history);
    return picked;
  }

  const picked = available[Math.floor(Math.random() * available.length)];
  state.seen.push(picked.id);
  saveHistory(history);
  return picked;
}

// ---------------------------------------------------------------------------
// Claude intro
// ---------------------------------------------------------------------------

function getReflection(userId) {
  const prompt = pickPrompt(userId);
  if (!prompt) return "No reflection categories enabled. Use `.reflect enable <category>` to turn one on.";
  return prompt.text;
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export default {
  name: "reflection",

  help: {
    reflect: "Get a reflection prompt. Usage: .reflect | .reflect categories | .reflect enable <cat> | .reflect disable <cat>",
  },

  commands: {
    reflect: async (msg, { reply }) => {
      const input = msg.text.replace(/^\.reflect\s*/i, "").trim();
      const [sub, ...rest] = input.split(/\s+/);
      const lowerSub = sub?.toLowerCase();

      if (!input || lowerSub === "show") {
        const text = getReflection(msg.userId);
        await reply(`🪞 ${text}`);
        return;
      }

      if (lowerSub === "categories") {
        const history = loadHistory();
        const state = getUserState(history, msg.userId);
        const lines = ALL_CATEGORIES.map((cat) => {
          const on = state.categories.includes(cat);
          return `${on ? "✅" : "⬜"} ${cat}`;
        });
        await reply(`Reflection categories:\n\n${lines.join("\n")}\n\nToggle: \`.reflect enable <cat>\` / \`.reflect disable <cat>\``);
        return;
      }

      if (lowerSub === "enable" || lowerSub === "disable") {
        const cat = rest[0]?.toLowerCase();
        if (!cat || !ALL_CATEGORIES.includes(cat)) {
          await reply(`Unknown category. Valid: ${ALL_CATEGORIES.join(", ")}`);
          return;
        }
        const history = loadHistory();
        const state = getUserState(history, msg.userId);
        if (lowerSub === "enable") {
          if (!state.categories.includes(cat)) state.categories.push(cat);
          saveHistory(history);
          await reply(`✅ Enabled category: ${cat}`);
        } else {
          state.categories = state.categories.filter((c) => c !== cat);
          saveHistory(history);
          await reply(`⬜ Disabled category: ${cat}`);
        }
        return;
      }

      await reply("Usage: `.reflect` | `.reflect categories` | `.reflect enable <cat>` | `.reflect disable <cat>`");
    },
  },

  schedules: [
    {
      // Fires at midnight PT to schedule the day's random reflection
      cron: process.env.REFLECTION_CRON || "0 8 * * *", // ~midnight PT (UTC-8)

      handler: async ({ channels, config }) => {
        _config = config;
        const targetChatId = config.plugins?.targetChatId;
        const targetChannel = config.plugins?.targetChannel || "telegram";
        if (!targetChatId) return;
        const channel = channels.get(targetChannel);
        if (!channel) return;
        scheduleRandomReflection(channel, String(targetChatId), String(targetChatId));
      },
    },
  ],

  init: async ({ channels, config }) => {
    _config = config;
    const targetChatId = config.plugins?.targetChatId;
    const targetChannel = config.plugins?.targetChannel || "telegram";
    if (!targetChatId) return;
    const channel = channels.get(targetChannel);
    if (!channel) return;
    scheduleRandomReflection(channel, String(targetChatId), String(targetChatId));
  },
};
