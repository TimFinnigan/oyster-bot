/**
 * Shows Plugin
 *
 * Get notified when a tracked TV show releases a new episode.
 * Uses the free TVMaze API (no key required).
 *
 * Commands:
 * - .shows add <name>     — search TVMaze and track a show
 * - .shows list           — list tracked shows
 * - .shows remove <name>  — stop tracking a show
 *
 * Schedule: daily at 9am PT, checks TVMaze schedule for today and
 * sends a ping for any tracked show with a new episode.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getDataDir } from "../src/runtime-paths.js";

const DATA_DIR = getDataDir();
const SHOWS_FILE = join(DATA_DIR, "shows.json");

const TVMAZE_API = "https://api.tvmaze.com";

// Pending search results waiting for user to pick: userId -> [results]
const pendingSearches = new Map();

// Pending removals waiting for user to confirm: userId -> [shows]
const pendingRemovals = new Map();

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadShows() {
  try {
    if (existsSync(SHOWS_FILE)) {
      const data = JSON.parse(readFileSync(SHOWS_FILE, "utf-8"));
      if (Array.isArray(data)) return data;
    }
  } catch (err) {
    console.error("[shows] Failed to load shows:", err.message);
  }
  return [];
}

function saveShows(shows) {
  ensureDataDir();
  writeFileSync(SHOWS_FILE, JSON.stringify(shows, null, 2));
}

// ---------------------------------------------------------------------------
// TVMaze API
// ---------------------------------------------------------------------------

async function searchShow(query) {
  const url = `${TVMAZE_API}/search/shows?q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TVMaze search failed: ${res.status}`);
  const results = await res.json();
  return results.slice(0, 3).map((r) => ({
    id: r.show.id,
    name: r.show.name,
    network: r.show.network?.name || r.show.webChannel?.name || "Unknown",
    status: r.show.status,
  }));
}

async function getShowWithEpisodes(showId) {
  try {
    const res = await fetch(`${TVMAZE_API}/shows/${showId}?embed[]=nextepisode&embed[]=previousepisode`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function getTodaysEpisodes(dateStr, country = "US") {
  const url = `${TVMAZE_API}/schedule?date=${dateStr}&country=${country}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TVMaze schedule failed: ${res.status}`);
  return await res.json();
}

// ---------------------------------------------------------------------------
// Date helper
// ---------------------------------------------------------------------------

function todayPT() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export default {
  name: "shows",

  help: {
    shows: "Track TV shows. Usage: .shows add <name> | .shows list | .shows remove <name>",
  },

  commands: {
    shows: async (msg, { reply }) => {
      const input = msg.text.replace(/^\.shows\s*/i, "").trim();
      const [sub, ...rest] = input.split(/\s+/);
      const lowerSub = sub?.toLowerCase();

      // .shows list (or bare .shows)
      if (!input || lowerSub === "list") {
        const shows = loadShows().filter((s) => s.userId === msg.userId);
        if (shows.length === 0) {
          await reply("No shows tracked. Use `.shows add <name>` to start.");
          return;
        }
        const showDetails = await Promise.all(shows.map((s) => getShowWithEpisodes(s.id)));
        const entries = shows.map((s, i) => {
          const detail = showDetails[i];
          const nextEp = detail?._embedded?.nextepisode;
          const prevEp = detail?._embedded?.previousepisode;
          return { s, nextEp, prevEp };
        });

        // Sort: shows with upcoming episodes first (by date), then by last aired
        entries.sort((a, b) => {
          const aNext = a.nextEp?.airdate;
          const bNext = b.nextEp?.airdate;
          if (aNext && bNext) return aNext.localeCompare(bNext);
          if (aNext) return -1;
          if (bNext) return 1;
          const aPrev = a.prevEp?.airdate || "";
          const bPrev = b.prevEp?.airdate || "";
          return bPrev.localeCompare(aPrev); // most recently aired first
        });

        const lines = entries.map(({ s, nextEp, prevEp }, i) => {
          let info;
          if (nextEp?.airdate) {
            info = `next ep ${nextEp.airdate}`;
          } else if (prevEp?.airdate) {
            info = `last aired ${prevEp.airdate}`;
          } else {
            info = s.status;
          }
          return `${i + 1}. ${s.name} (${s.network}) — ${info}`;
        });
        await reply(`📺 Your tracked shows:\n\n${lines.join("\n")}`);
        return;
      }

      // .shows add <name>
      if (lowerSub === "add") {
        const query = rest.join(" ").trim();
        if (!query) {
          await reply("Usage: `.shows add <name>`\nExample: `.shows add Severance`");
          return;
        }

        let results;
        try {
          results = await searchShow(query);
        } catch (err) {
          await reply(`❌ Search failed: ${err.message}`);
          return;
        }

        if (results.length === 0) {
          await reply(`❌ No shows found for "${query}".`);
          return;
        }

        if (results.length === 1) {
          const show = results[0];
          const shows = loadShows();
          if (shows.some((s) => s.userId === msg.userId && s.id === show.id)) {
            await reply(`Already tracking **${show.name}**.`);
            return;
          }
          shows.push({ userId: msg.userId, ...show });
          saveShows(shows);
          await reply(`✅ Now tracking **${show.name}** (${show.network}) — ${show.status}`);
          return;
        }

        // Multiple results — ask user to pick
        pendingSearches.set(msg.userId, results);
        const lines = results.map((r, i) => `${i + 1}. **${r.name}** (${r.network}) — ${r.status}`);
        await reply(`Found ${results.length} results. Reply with a number to pick:\n\n${lines.join("\n")}`);
        return;
      }

      // .shows remove — show list and ask to pick
      if (lowerSub === "remove") {
        const userShows = loadShows().filter((s) => s.userId === msg.userId);
        if (userShows.length === 0) {
          await reply("No shows tracked. Nothing to remove.");
          return;
        }
        pendingRemovals.set(msg.userId, userShows);
        const lines = userShows.map((s, i) => `${i + 1}. **${s.name}** (${s.network})`);
        await reply(`Which show do you want to remove? Reply with a number:\n\n${lines.join("\n")}`);
        return;
      }

      await reply("Usage: `.shows add <name>` | `.shows list` | `.shows remove <name>`");
    },
  },

  onMessage: async (msg, { reply }) => {
    const num = parseInt(msg.text?.trim(), 10);

    // Handle pending search pick
    if (pendingSearches.has(msg.userId)) {
      const results = pendingSearches.get(msg.userId);
      if (isNaN(num) || num < 1 || num > results.length) {
        await reply(`Please reply with a number between 1 and ${results.length}, or use \`.shows add <name>\` to search again.`);
        return true;
      }
      pendingSearches.delete(msg.userId);
      const picked = results[num - 1];
      const shows = loadShows();
      if (shows.some((s) => s.userId === msg.userId && s.id === picked.id)) {
        await reply(`Already tracking **${picked.name}**.`);
        return true;
      }
      shows.push({ userId: msg.userId, ...picked });
      saveShows(shows);
      await reply(`✅ Now tracking **${picked.name}** (${picked.network}) — ${picked.status}`);
      return true;
    }

    // Handle pending removal pick
    if (pendingRemovals.has(msg.userId)) {
      const userShows = pendingRemovals.get(msg.userId);
      if (isNaN(num) || num < 1 || num > userShows.length) {
        await reply(`Please reply with a number between 1 and ${userShows.length}, or use \`.shows list\` to start over.`);
        return true;
      }
      pendingRemovals.delete(msg.userId);
      const toRemove = userShows[num - 1];
      const allShows = loadShows().filter((s) => !(s.userId === msg.userId && s.id === toRemove.id));
      saveShows(allShows);
      await reply(`🗑️ Stopped tracking **${toRemove.name}**.`);
      return true;
    }

    return false;
  },

  schedules: [
    {
      // 9am PT = 17:00 UTC (winter) — override with SHOWS_CRON env var
      cron: process.env.SHOWS_CRON || "0 17 * * *",

      handler: async ({ channels, config }) => {
        const targetChatId = config.plugins?.targetChatId;
        const targetChannel = config.plugins?.targetChannel || "telegram";

        if (!targetChatId) {
          console.log("[shows] No PLUGIN_TARGET_CHAT_ID configured, skipping");
          return;
        }

        const channel = channels.get(targetChannel);
        if (!channel) {
          console.log(`[shows] Channel '${targetChannel}' not available`);
          return;
        }

        const userId = String(targetChatId);
        const tracked = loadShows().filter((s) => s.userId === userId);
        if (tracked.length === 0) return;

        let schedule;
        try {
          schedule = await getTodaysEpisodes(todayPT(), "US");
        } catch (err) {
          console.error("[shows] Failed to fetch schedule:", err.message);
          return;
        }

        // Also fetch GB schedule for UK shows
        let gbSchedule = [];
        try {
          gbSchedule = await getTodaysEpisodes(todayPT(), "GB");
        } catch {
          // GB schedule optional
        }

        const trackedIds = new Set(tracked.map((s) => s.id));
        const combined = [...schedule, ...gbSchedule];
        const seen = new Set();
        const airing = combined.filter((ep) => {
          if (!trackedIds.has(ep.show.id) || seen.has(ep.id)) return false;
          seen.add(ep.id);
          return true;
        });

        if (airing.length === 0) return;

        const lines = airing.map((ep) => {
          const show = ep.show.name;
          const season = ep.season;
          const epNum = String(ep.number).padStart(2, "0");
          const epName = ep.name ? ` — "${ep.name}"` : "";
          const time = ep.airtime ? ` at ${ep.airtime}` : "";
          const network = ep.show.network?.name || ep.show.webChannel?.name || "";
          return `📺 **${show}** S${season}E${epNum}${epName}${time}${network ? ` (${network})` : ""}`;
        });

        await channel.send(userId, `🎬 New episodes today!\n\n${lines.join("\n")}`);
        console.log(`[shows] Sent episode alert for ${airing.length} show(s)`);
      },
    },
  ],
};
