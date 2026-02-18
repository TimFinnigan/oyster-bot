/**
 * Feature Request Plugin
 *
 * Claude brainstorms feature ideas for oyster-bot, then opens GitHub issues.
 * Ignores all existing open/closed feature requests to avoid duplicates.
 *
 * - .feature — Brainstorm 1 feature idea and open a GitHub issue
 * - .feature 3 — Brainstorm 3 feature ideas and open issues for each
 *
 * Requires: gh CLI authenticated
 */

const GITHUB_REPO = process.env.GITHUB_REPO || "TimFinnigan/oyster-bot";

import { execSync as _execSync } from "child_process";

function getExistingFeatures() {
  try {
    const out = _execSync(
      `gh issue list --repo ${GITHUB_REPO} --state all --label "feature-request" --json title --limit 200`,
      { encoding: "utf-8" }
    );
    return JSON.parse(out).map((i) => i.title);
  } catch {
    return [];
  }
}

function buildBrainstormPrompt(count, existing) {
  const existingClause = existing.length > 0
    ? `\n\nDo NOT suggest any of these already-existing feature requests:\n${existing.map((t) => `- ${t}`).join("\n")}`
    : "";

  return `You are a product manager for "oyster-bot" — a self-hosted Telegram bot that wraps Claude AI. It supports plugins, reminders, weather, quotes, a routine-breaker, and an orchestrator for goal tracking. Users chat with Claude via Telegram from their phone.

Brainstorm ${count} genuinely useful, creative, and distinct feature idea${count > 1 ? "s" : ""} for this bot. Think about what would make it more useful day-to-day for a solo user.

For each idea, write a full GitHub issue with:
- A concise title
- A ## Summary section (2-3 sentences)
- A ## Motivation section (why it's useful)
- A ## Proposed Solution section (how it could work)
- A ## Acceptance Criteria section (bulleted checklist)${existingClause}

Output ONLY valid JSON in this exact format, no other text:
[
  {
    "title": "issue title",
    "body": "full markdown body"
  }
]`;
}

async function createIssue(title, body) {
  const { writeFileSync, unlinkSync } = await import("fs");
  const { tmpdir } = await import("os");
  const { join } = await import("path");

  const tmpFile = join(tmpdir(), `feature-request-${Date.now()}.md`);
  writeFileSync(tmpFile, body, "utf-8");

  const cmd = `gh issue create --repo ${GITHUB_REPO} --title ${JSON.stringify(title)} --body-file ${JSON.stringify(tmpFile)} --label "feature-request"`;
  const url = _execSync(cmd, { encoding: "utf-8" }).trim();

  try { unlinkSync(tmpFile); } catch {}

  return url;
}

export default {
  name: "feature",

  help: {
    feature: "Brainstorm feature ideas and open GitHub issues (e.g. .feature or .feature 3)",
  },

  commands: {
    feature: async (msg, { reply, sendTyping, claude }) => {
      const input = msg.text.replace(/^\.feature\s*/i, "").trim();
      const count = Math.min(parseInt(input, 10) || 1, 5);

      await sendTyping();
      await reply(`🧠 Brainstorming ${count} feature idea${count > 1 ? "s" : ""}...`);

      const existing = getExistingFeatures();

      let ideas;
      try {
        const response = await claude(buildBrainstormPrompt(count, existing));
        const raw = response.result || response.content || "";

        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error("No JSON array found in response");

        ideas = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(ideas) || ideas.length === 0) throw new Error("Empty ideas array");
      } catch (err) {
        console.error("[feature] Failed to brainstorm ideas:", err.message);
        await reply(`❌ Couldn't generate ideas: ${err.message}`);
        return;
      }

      for (const idea of ideas) {
        const { title, body } = idea;
        if (!title || !body) continue;

        try {
          const url = await createIssue(title, body);
          await reply(`✅ **${title}**\n${url}`);
        } catch (err) {
          console.error("[feature] Failed to create issue:", err.message);
          await reply(`❌ Failed to open issue for "${title}": ${err.message.slice(0, 200)}`);
        }
      }
    },
  },
};
