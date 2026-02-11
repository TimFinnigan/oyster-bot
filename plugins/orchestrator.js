/**
 * Orchestrator Plugin
 *
 * A self-organizing agent that reasons about user goals, generates ideas,
 * proposes actions, and tracks progress. Runs autonomously on a schedule
 * but requires human approval for actions.
 *
 * Commands:
 * - .goal <text> — Add a new goal
 * - .goals — List all active goals
 * - .rmgoal <id> — Remove/pause a goal
 * - .ideas — Show current ideas being tracked
 * - .oidea <text> — Manually add an idea
 * - .approve — Approve pending proposal
 * - .reject [reason] — Reject proposal with optional feedback
 * - .checkin — Trigger manual check-in (don't wait for schedule)
 * - .ostatus — Show orchestrator state and next scheduled run
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getDataDir } from "../src/runtime-paths.js";

const DATA_DIR = getDataDir();
const GOALS_FILE = join(DATA_DIR, "orchestrator-goals.json");
const IDEAS_FILE = join(DATA_DIR, "orchestrator-ideas.json");
const STATE_FILE = join(DATA_DIR, "orchestrator-state.json");
const HISTORY_FILE = join(DATA_DIR, "orchestrator-history.json");

// Store references for scheduled tasks
let _channels = null;
let _runClaude = null;
let _registerNotification = null;
let _unregisterNotification = null;
let _scheduledTask = null;

// Get cron schedule from env or use default (9am daily)
const ORCHESTRATOR_CRON = process.env.ORCHESTRATOR_CRON || "0 9 * * *";
const ORCHESTRATOR_ENABLED = process.env.ORCHESTRATOR_ENABLED !== "false";

// ============================================================================
// Data Layer
// ============================================================================

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadJson(filePath, defaultValue = []) {
  try {
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, "utf-8"));
    }
  } catch (err) {
    console.error(`[orchestrator] Error loading ${filePath}:`, err.message);
  }
  return defaultValue;
}

function saveJson(filePath, data) {
  ensureDataDir();
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function loadGoals() {
  return loadJson(GOALS_FILE, []);
}

function saveGoals(goals) {
  saveJson(GOALS_FILE, goals);
}

function loadIdeas() {
  return loadJson(IDEAS_FILE, []);
}

function saveIdeas(ideas) {
  saveJson(IDEAS_FILE, ideas);
}

function loadState() {
  return loadJson(STATE_FILE, {});
}

function saveState(state) {
  saveJson(STATE_FILE, state);
}

function loadHistory() {
  return loadJson(HISTORY_FILE, []);
}

function saveHistory(history) {
  saveJson(HISTORY_FILE, history);
}

function generateId() {
  return Math.random().toString(36).substring(2, 8);
}

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

// ============================================================================
// Orchestrator Loop
// ============================================================================

function buildClaudePrompt(goals, ideas, recentHistory, pastIdeas = []) {
  const goalsText = goals.length > 0
    ? goals.map((g, i) => `${i + 1}. ${g.text}${g.context ? ` (Context: ${g.context})` : ""}`).join("\n")
    : "No active goals set.";

  const ideasByStatus = {
    new: ideas.filter(i => i.status === "new"),
    exploring: ideas.filter(i => i.status === "exploring"),
    in_progress: ideas.filter(i => i.status === "in_progress"),
  };

  let ideasText = "";
  if (ideasByStatus.new.length > 0) {
    ideasText += "New ideas:\n" + ideasByStatus.new.map(i => `- ${i.text}`).join("\n") + "\n";
  }
  if (ideasByStatus.exploring.length > 0) {
    ideasText += "Exploring:\n" + ideasByStatus.exploring.map(i => `- ${i.text}`).join("\n") + "\n";
  }
  if (ideasByStatus.in_progress.length > 0) {
    ideasText += "In progress:\n" + ideasByStatus.in_progress.map(i => `- ${i.text}`).join("\n") + "\n";
  }
  if (!ideasText) {
    ideasText = "No current ideas being tracked.";
  }

  const recentText = recentHistory.length > 0
    ? recentHistory.slice(-5).map(h => {
        const status = h.status === "approved" ? "✓" : "✗";
        return `${status} ${h.action || h.text} (${h.status})`;
      }).join("\n")
    : "No recent activity.";

  return `You are an autonomous agent helping the user achieve their goals.
Your role is to propose concrete, actionable tasks for today based on their goals and current context.

## Active Goals
${goalsText}

## Current Ideas
${ideasText}

## Recent Activity
${recentText}

## Past Ideas (already suggested — do NOT repeat these)
${pastIdeas.length > 0 ? pastIdeas.map(i => `- [${i.status}] ${i.text}`).join("\n") : "None yet."}

Based on this context, propose 1-3 concrete actions for today.
For each action, explain briefly why it moves toward the goal.
You may also suggest new ideas that could help achieve the goals.
Do NOT repeat any ideas listed in "Current Ideas" or "Past Ideas" above — only suggest genuinely new ones.

IMPORTANT: Respond ONLY with valid JSON in this exact format, no other text:
{
  "reasoning": "brief overall reasoning for today's focus",
  "actions": [
    { "description": "specific action to take", "why": "how this helps the goal" }
  ],
  "newIdeas": [
    { "text": "idea description", "reasoning": "why this could help" }
  ]
}`;
}

function parseClaudeResponse(responseText) {
  try {
    // Try to extract JSON from the response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        reasoning: parsed.reasoning || "",
        actions: Array.isArray(parsed.actions) ? parsed.actions : [],
        newIdeas: Array.isArray(parsed.newIdeas) ? parsed.newIdeas : [],
      };
    }
  } catch (err) {
    console.error("[orchestrator] Failed to parse Claude response:", err.message);
  }
  return null;
}

function formatProposalMessage(proposal, goals) {
  const lines = ["🎯 Daily Check-in\n"];

  if (goals.length > 0) {
    lines.push(`Goal: ${goals[0].text}\n`);
  }

  if (proposal.reasoning) {
    lines.push(proposal.reasoning + "\n");
  }

  if (proposal.actions && proposal.actions.length > 0) {
    lines.push("Suggested actions for today:\n");
    proposal.actions.forEach((action, i) => {
      lines.push(`${i + 1}. ${action.description}`);
      if (action.why) {
        lines.push(`   → ${action.why}`);
      }
    });
    lines.push("");
  }

  if (proposal.newIdeas && proposal.newIdeas.length > 0) {
    lines.push("New ideas generated:");
    proposal.newIdeas.forEach(idea => {
      lines.push(`• ${idea.text}`);
    });
    lines.push("");
  }

  lines.push("Reply `.approve` to proceed, or `.reject [feedback]` to decline.");

  return lines.join("\n");
}

async function runCheckIn(userId, channelType, channelId) {
  if (!_runClaude || !_channels) {
    console.error("[orchestrator] Not initialized");
    return null;
  }

  const channel = _channels.get(channelType);
  if (!channel) {
    console.error(`[orchestrator] Channel '${channelType}' not available`);
    return null;
  }

  // Load data for this user
  const allGoals = loadGoals();
  const userGoals = allGoals.filter(g => g.userId === userId && g.status === "active");

  if (userGoals.length === 0) {
    await channel.send(channelId, "No active goals set. Use `.goal <text>` to add one!");
    return null;
  }

  const allIdeas = loadIdeas();
  const userIdeas = allIdeas.filter(i =>
    userGoals.some(g => g.id === i.goalId) &&
    ["new", "exploring", "in_progress"].includes(i.status)
  );
  const pastIdeas = allIdeas.filter(i =>
    userGoals.some(g => g.id === i.goalId) &&
    ["completed", "rejected"].includes(i.status)
  );

  const history = loadHistory();
  const recentHistory = history.filter(h => h.userId === userId).slice(-10);

  // Build prompt and call Claude
  const prompt = buildClaudePrompt(userGoals, userIdeas, recentHistory, pastIdeas);

  console.log("[orchestrator] Running check-in for user:", userId);

  try {
    const response = await _runClaude(prompt);
    const proposal = parseClaudeResponse(response.result);

    if (!proposal) {
      await channel.send(channelId, "I had trouble generating a proposal. Please try `.checkin` again.");
      return null;
    }

    // Store any new ideas from the proposal
    if (proposal.newIdeas && proposal.newIdeas.length > 0) {
      const ideas = loadIdeas();
      const primaryGoalId = userGoals[0].id;

      for (const newIdea of proposal.newIdeas) {
        ideas.push({
          id: generateId(),
          goalId: primaryGoalId,
          text: newIdea.text,
          status: "new",
          reasoning: newIdea.reasoning || "",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      saveIdeas(ideas);
    }

    // Update state with pending proposal
    const state = loadState();
    state[userId] = {
      lastCheckIn: new Date().toISOString(),
      pendingProposal: {
        actions: proposal.actions,
        reasoning: proposal.reasoning,
        createdAt: new Date().toISOString(),
      },
      awaitingApproval: true,
      channelType,
      channelId,
    };
    saveState(state);

    // Register notification for pending proposal
    if (_registerNotification) {
      _registerNotification(`orchestrator-${userId}`, {
        pluginName: "orchestrator",
        label: "Pending proposal awaiting approval",
        type: "proposal",
        meta: { userId, actions: proposal.actions.length },
      });
    }

    // Send formatted message to user
    const message = formatProposalMessage(proposal, userGoals);
    await channel.send(channelId, message);

    return proposal;
  } catch (err) {
    console.error("[orchestrator] Check-in error:", err.message);
    await channel.send(channelId, `Check-in error: ${err.message.slice(0, 200)}`);
    return null;
  }
}

function buildExecutionPrompt(action, goal) {
  return `You are an autonomous agent executing a task for the user.

## Goal
${goal.text}${goal.context ? ` (Context: ${goal.context})` : ""}

## Task
${action.description}

## Why
${action.why}

## Instructions
- Actually DO the work, don't just describe what you would do.
- Use WebSearch and WebFetch to research real information.
- Produce a concrete deliverable: research findings, drafted content, analysis, etc.
- Be thorough but concise in your output.
- Format your output as something the user can immediately use or act on.
- If the task requires creating content (e.g., social media posts, product descriptions), write the actual content.
- If the task requires research, provide specific findings with sources.
- IMPORTANT: If you need to create any files, save them under ${DATA_DIR} — never write files outside that directory.`;
}

async function executeActions(actions, goal, userId, channelType, channelId) {
  const channel = _channels?.get(channelType);
  if (!channel || !_runClaude) {
    console.error("[orchestrator] Cannot execute: missing channel or Claude");
    return;
  }

  const results = [];

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const label = action.description.length > 80
      ? action.description.slice(0, 77) + "..."
      : action.description;

    await channel.send(channelId, `⚡ Working on action ${i + 1}/${actions.length}: ${label}`);

    try {
      const prompt = buildExecutionPrompt(action, goal);
      const response = await _runClaude(prompt);
      const result = response.result || "No output produced.";

      // Truncate for Telegram (keep under 4000 chars to leave room for formatting)
      const truncated = result.length > 3500
        ? result.slice(0, 3500) + "\n\n... (truncated)"
        : result;

      await channel.send(channelId, `✅ Action ${i + 1} complete:\n\n${truncated}`);
      results.push({ index: i, description: action.description, result, executedAt: new Date().toISOString() });
    } catch (err) {
      console.error(`[orchestrator] Execution error for action ${i + 1}:`, err.message);
      await channel.send(channelId, `❌ Action ${i + 1} failed: ${err.message.slice(0, 200)}`);
      results.push({ index: i, description: action.description, error: err.message, executedAt: new Date().toISOString() });
    }
  }

  // Save results to history
  const history = loadHistory();
  for (const r of results) {
    const entry = history.find(
      h => h.userId === userId && h.action === r.description && h.status === "approved" && !h.executedAt
    );
    if (entry) {
      entry.result = r.error ? `Error: ${r.error}` : r.result;
      entry.executedAt = r.executedAt;
    }
  }
  saveHistory(history);

  // Export full results to markdown in data dir
  const dateStr = new Date().toISOString().slice(0, 10);
  const mdLines = [`# Orchestrator Results — ${dateStr}\n`, `**Goal:** ${goal.text}\n`, "---\n"];
  for (const r of results) {
    const status = r.error ? "FAILED" : "COMPLETED";
    mdLines.push(`## Action ${r.index + 1}: ${r.description}\n`);
    mdLines.push(`**Status:** ${status}  `);
    mdLines.push(`**Executed:** ${new Date(r.executedAt).toLocaleTimeString()}\n`);
    mdLines.push(r.error ? `**Error:** ${r.error}\n` : `${r.result}\n`);
    mdLines.push("---\n");
  }
  const mdPath = join(DATA_DIR, `orchestrator-results-${dateStr}.md`);
  try {
    writeFileSync(mdPath, mdLines.join("\n"));
    console.log(`[orchestrator] Results saved to ${mdPath}`);
  } catch (err) {
    console.error("[orchestrator] Failed to save results md:", err.message);
  }

  const succeeded = results.filter(r => !r.error).length;
  await channel.send(channelId, `🏁 Done! ${succeeded}/${actions.length} actions completed. Full results saved to data/orchestrator-results-${dateStr}.md`);
}

async function runScheduledCheckIn() {
  console.log("[orchestrator] Running scheduled check-in");

  // Find users with active goals
  const goals = loadGoals();
  const activeGoals = goals.filter(g => g.status === "active");

  // Group by user
  const userGoals = new Map();
  for (const goal of activeGoals) {
    if (!userGoals.has(goal.userId)) {
      userGoals.set(goal.userId, goal);
    }
  }

  // Run check-in for each user
  for (const [userId, goal] of userGoals) {
    // Skip if user already has pending approval
    const state = loadState();
    if (state[userId]?.awaitingApproval) {
      console.log(`[orchestrator] Skipping ${userId}: already awaiting approval`);
      continue;
    }

    await runCheckIn(userId, goal.channelType, goal.channelId);
  }
}

// ============================================================================
// Commands
// ============================================================================

export default {
  name: "orchestrator",

  help: {
    goal: "Add a new goal (e.g., .goal Build an audience around AI content)",
    goals: "List all active goals",
    rmgoal: "Remove/pause a goal by number or ID",
    oidea: "Add an idea for your current goal",
    ideas: "Show current ideas being tracked",
    approve: "Approve pending orchestrator proposal",
    reject: "Reject proposal with optional feedback",
    checkin: "Trigger manual check-in now",
    ostatus: "Show orchestrator state and next scheduled run",
    results: "View today's execution results",
  },

  commands: {
    goal: async (msg, { reply }) => {
      const input = msg.text.replace(/^\.goal\s*/i, "").trim();

      if (!input) {
        await reply("Usage: `.goal <text>`\nExample: `.goal Build an audience around AI content`");
        return;
      }

      // Check for context (text after " - " or " | ")
      let text = input;
      let context = "";
      const contextMatch = input.match(/^(.+?)\s*[-|]\s*(.+)$/);
      if (contextMatch) {
        text = contextMatch[1].trim();
        context = contextMatch[2].trim();
      }

      const goal = {
        id: generateId(),
        userId: msg.userId,
        channelType: msg.channelType,
        channelId: msg.channelId,
        text,
        context,
        status: "active",
        createdAt: new Date().toISOString(),
      };

      const goals = loadGoals();
      goals.push(goal);
      saveGoals(goals);

      await reply(`✅ Goal added: "${text}"\n\nUse \`.checkin\` to trigger a check-in or wait for the scheduled time.`);
    },

    goals: async (msg, { reply }) => {
      const goals = loadGoals().filter(g => g.userId === msg.userId);

      if (goals.length === 0) {
        await reply("No goals set. Use `.goal <text>` to add one!");
        return;
      }

      const activeGoals = goals.filter(g => g.status === "active");
      const pausedGoals = goals.filter(g => g.status === "paused");

      const lines = [];

      if (activeGoals.length > 0) {
        lines.push("🎯 Active goals:\n");
        activeGoals.forEach((g, i) => {
          lines.push(`${i + 1}. ${g.text}`);
          if (g.context) lines.push(`   Context: ${g.context}`);
          lines.push(`   Added: ${formatDate(g.createdAt)}`);
        });
      }

      if (pausedGoals.length > 0) {
        if (lines.length > 0) lines.push("");
        lines.push("⏸️ Paused goals:\n");
        pausedGoals.forEach((g, i) => {
          lines.push(`${i + 1}. ${g.text}`);
        });
      }

      lines.push("\nRemove with: `.rmgoal <number>`");

      await reply(lines.join("\n"));
    },

    rmgoal: async (msg, { reply }) => {
      const input = msg.text.replace(/^\.rmgoal\s*/i, "").trim();

      if (!input) {
        await reply("Usage: `.rmgoal <number or id>`\nUse `.goals` to see your goals.");
        return;
      }

      const goals = loadGoals();
      const userGoals = goals.filter(g => g.userId === msg.userId && g.status === "active");

      let removed = null;
      const num = parseInt(input, 10);

      if (!isNaN(num) && num >= 1 && num <= userGoals.length) {
        removed = userGoals[num - 1];
      } else {
        removed = userGoals.find(g => g.id === input);
      }

      if (!removed) {
        await reply(`❌ Goal "${input}" not found. Use \`.goals\` to see your goals.`);
        return;
      }

      // Mark as paused rather than deleting
      const idx = goals.findIndex(g => g.id === removed.id);
      goals[idx].status = "paused";
      saveGoals(goals);

      await reply(`✅ Paused goal: "${removed.text}"`);
    },

    oidea: async (msg, { reply }) => {
      const input = msg.text.replace(/^\.oidea\s*/i, "").trim();

      if (!input) {
        await reply("Usage: `.oidea <text>`\nExample: `.oidea Write a Twitter thread about multi-agent systems`");
        return;
      }

      // Find user's primary active goal
      const goals = loadGoals().filter(g => g.userId === msg.userId && g.status === "active");

      if (goals.length === 0) {
        await reply("❌ No active goals. Add a goal first with `.goal <text>`");
        return;
      }

      const idea = {
        id: generateId(),
        goalId: goals[0].id,
        text: input,
        status: "new",
        reasoning: "Manually added by user",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const ideas = loadIdeas();
      ideas.push(idea);
      saveIdeas(ideas);

      await reply(`✅ Idea added: "${input}"`);
    },

    ideas: async (msg, { reply }) => {
      const goals = loadGoals().filter(g => g.userId === msg.userId);
      const goalIds = new Set(goals.map(g => g.id));
      const ideas = loadIdeas().filter(i => goalIds.has(i.goalId));

      if (ideas.length === 0) {
        await reply("No ideas tracked yet. Add one with `.oidea <text>` or run `.checkin` to generate some!");
        return;
      }

      const byStatus = {
        new: ideas.filter(i => i.status === "new"),
        exploring: ideas.filter(i => i.status === "exploring"),
        in_progress: ideas.filter(i => i.status === "in_progress"),
        completed: ideas.filter(i => i.status === "completed"),
        rejected: ideas.filter(i => i.status === "rejected"),
      };

      const lines = ["💡 Your ideas:\n"];

      if (byStatus.new.length > 0) {
        lines.push("New:");
        byStatus.new.forEach(i => lines.push(`  • ${i.text}`));
      }
      if (byStatus.exploring.length > 0) {
        lines.push("Exploring:");
        byStatus.exploring.forEach(i => lines.push(`  • ${i.text}`));
      }
      if (byStatus.in_progress.length > 0) {
        lines.push("In progress:");
        byStatus.in_progress.forEach(i => lines.push(`  • ${i.text}`));
      }
      if (byStatus.completed.length > 0) {
        lines.push("Completed:");
        byStatus.completed.slice(-3).forEach(i => lines.push(`  ✓ ${i.text}`));
      }

      await reply(lines.join("\n"));
    },

    approve: async (msg, { reply }) => {
      const state = loadState();
      const userState = state[msg.userId];

      if (!userState?.awaitingApproval || !userState?.pendingProposal) {
        await reply("No pending proposal to approve. Use `.checkin` to generate one.");
        return;
      }

      const proposal = userState.pendingProposal;

      // Record approval in history
      const history = loadHistory();
      for (const action of proposal.actions) {
        history.push({
          userId: msg.userId,
          action: action.description,
          why: action.why,
          status: "approved",
          approvedAt: new Date().toISOString(),
          proposedAt: proposal.createdAt,
        });
      }
      saveHistory(history);

      // Update ideas that were part of the proposal to "in_progress"
      const ideas = loadIdeas();
      const goals = loadGoals().filter(g => g.userId === msg.userId && g.status === "active");
      const goalIds = new Set(goals.map(g => g.id));

      for (const idea of ideas) {
        if (goalIds.has(idea.goalId) && idea.status === "new") {
          idea.status = "exploring";
          idea.updatedAt = new Date().toISOString();
        }
      }
      saveIdeas(ideas);

      // Clear pending state
      userState.awaitingApproval = false;
      userState.pendingProposal = null;
      userState.lastApproval = new Date().toISOString();
      saveState(state);

      // Unregister notification
      if (_unregisterNotification) {
        _unregisterNotification(`orchestrator-${msg.userId}`);
      }

      const actionList = proposal.actions.map((a, i) => `${i + 1}. ${a.description}`).join("\n");
      await reply(`✅ Approved! Here's today's focus:\n\n${actionList}\n\n🚀 Executing now...`);

      // Get the user's primary goal for context (reuse goals from above)
      const primaryGoal = goals[0] || { text: "No goal set", context: "" };

      // Execute actions (don't await — let it run in background so the user isn't blocked)
      executeActions(proposal.actions, primaryGoal, msg.userId, msg.channelType, msg.channelId).catch(err => {
        console.error("[orchestrator] executeActions failed:", err.message);
      });
    },

    reject: async (msg, { reply }) => {
      const state = loadState();
      const userState = state[msg.userId];

      if (!userState?.awaitingApproval || !userState?.pendingProposal) {
        await reply("No pending proposal to reject. Use `.checkin` to generate one.");
        return;
      }

      const feedback = msg.text.replace(/^\.reject\s*/i, "").trim();
      const proposal = userState.pendingProposal;

      // Record rejection in history
      const history = loadHistory();
      history.push({
        userId: msg.userId,
        actions: proposal.actions,
        status: "rejected",
        feedback: feedback || null,
        rejectedAt: new Date().toISOString(),
        proposedAt: proposal.createdAt,
      });
      saveHistory(history);

      // Clear pending state
      userState.awaitingApproval = false;
      userState.pendingProposal = null;
      userState.lastRejection = new Date().toISOString();
      userState.lastRejectionFeedback = feedback || null;
      saveState(state);

      // Unregister notification
      if (_unregisterNotification) {
        _unregisterNotification(`orchestrator-${msg.userId}`);
      }

      if (feedback) {
        await reply(`📝 Got it, proposal rejected. I'll take your feedback into account:\n"${feedback}"\n\nUse \`.checkin\` when you want a new proposal.`);
      } else {
        await reply("📝 Got it, proposal rejected. Use `.checkin` when you want a new proposal.");
      }
    },

    checkin: async (msg, { reply, channels, claude }) => {
      // Store refs if not set
      if (!_channels) _channels = channels;
      if (!_runClaude) _runClaude = claude;

      await reply("🔄 Running check-in...");
      await runCheckIn(msg.userId, msg.channelType, msg.channelId);
    },

    ostatus: async (msg, { reply }) => {
      const state = loadState();
      const userState = state[msg.userId];
      const goals = loadGoals().filter(g => g.userId === msg.userId && g.status === "active");
      const ideas = loadIdeas().filter(i =>
        goals.some(g => g.id === i.goalId) &&
        ["new", "exploring", "in_progress"].includes(i.status)
      );

      const lines = ["📊 Orchestrator Status\n"];

      // Goals summary
      lines.push(`Goals: ${goals.length} active`);
      lines.push(`Ideas: ${ideas.length} tracked`);

      // Schedule info
      lines.push(`\nSchedule: ${ORCHESTRATOR_CRON}`);
      lines.push(`Enabled: ${ORCHESTRATOR_ENABLED ? "Yes" : "No"}`);

      // Last activity
      if (userState?.lastCheckIn) {
        lines.push(`\nLast check-in: ${formatDate(userState.lastCheckIn)}`);
      }
      if (userState?.lastApproval) {
        lines.push(`Last approval: ${formatDate(userState.lastApproval)}`);
      }

      // Pending proposal
      if (userState?.awaitingApproval && userState?.pendingProposal) {
        lines.push(`\n⏳ Pending proposal with ${userState.pendingProposal.actions?.length || 0} action(s)`);
        lines.push("Reply `.approve` or `.reject [feedback]`");
      } else {
        lines.push("\nNo pending proposal. Use `.checkin` to generate one.");
      }

      await reply(lines.join("\n"));
    },

    results: async (msg, { reply }) => {
      const history = loadHistory();
      const today = new Date().toISOString().slice(0, 10);
      const todayResults = history.filter(
        h => h.userId === msg.userId && h.executedAt && h.executedAt.startsWith(today)
      );

      if (todayResults.length === 0) {
        await reply("No execution results for today. Approve a proposal with `.approve` to get started.");
        return;
      }

      for (const [i, entry] of todayResults.entries()) {
        const label = entry.action.length > 60
          ? entry.action.slice(0, 57) + "..."
          : entry.action;
        const status = entry.result?.startsWith("Error:") ? "❌" : "✅";
        const result = entry.result || "No output";
        const truncated = result.length > 3500
          ? result.slice(0, 3500) + "\n\n... (truncated)"
          : result;

        await reply(`${status} Result ${i + 1}: ${label}\n\n${truncated}`);
      }
    },
  },

  schedules: ORCHESTRATOR_ENABLED ? [
    {
      cron: ORCHESTRATOR_CRON,
      label: "Orchestrator daily check-in",
      handler: runScheduledCheckIn,
    },
  ] : [],

  init: async ({ channels, claude, registerNotification, unregisterNotification }) => {
    _channels = channels;
    _runClaude = claude;
    _registerNotification = registerNotification || null;
    _unregisterNotification = unregisterNotification || null;

    // Check for any pending proposals and re-register notifications
    const state = loadState();
    for (const [userId, userState] of Object.entries(state)) {
      if (userState?.awaitingApproval && _registerNotification) {
        _registerNotification(`orchestrator-${userId}`, {
          pluginName: "orchestrator",
          label: "Pending proposal awaiting approval",
          type: "proposal",
          meta: { userId, actions: userState.pendingProposal?.actions?.length || 0 },
        });
      }
    }

    console.log(`[orchestrator] Initialized (schedule: ${ORCHESTRATOR_CRON}, enabled: ${ORCHESTRATOR_ENABLED})`);
  },

  destroy: () => {
    if (_scheduledTask) {
      _scheduledTask.stop();
      _scheduledTask = null;
    }
    console.log("[orchestrator] Destroyed");
  },
};
