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

function buildSpecificPrompt(idea, existing) {
  const existingClause = existing.length > 0
    ? `\n\nDo NOT suggest any of these already-existing feature requests:\n${existing.map((t) => `- ${t}`).join("\n")}`
    : "";

  return `You are a product manager for "oyster-bot" — a self-hosted Telegram bot that wraps Claude AI. It supports plugins, reminders, weather, quotes, a routine-breaker, and an orchestrator for goal tracking.

The user wants to create a GitHub feature request for this idea:
"${idea}"

Write a full GitHub issue with:
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

function getIssue(number) {
  const out = _execSync(
    `gh issue view ${number} --repo ${GITHUB_REPO} --json title,body,url`,
    { encoding: "utf-8" }
  );
  return JSON.parse(out);
}

function buildImplementPrompt(issue) {
  return `You are implementing a feature for "oyster-bot" — a self-hosted Telegram bot that wraps Claude AI.

Here is the GitHub feature request to implement:

# ${issue.title}

${issue.body}

## Instructions
- Implement this feature in the oyster-bot codebase at /Users/tim/Claude/oyster-bot
- Follow existing patterns (look at other plugins for reference)
- New plugins go in /Users/tim/Claude/oyster-bot/plugins/
- Keep it simple and focused — only implement what the issue describes
- When done, summarize what you changed and which files were modified`;
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
    feature: "Brainstorm/create feature requests or implement one. Usage: .feature | .feature 3 | .feature <idea> | .feature do <number>",
  },

  commands: {
    feature: async (msg, { reply, sendTyping, claude }) => {
      const input = msg.text.replace(/^\.feature\s*/i, "").trim();

      // .feature do <number> — implement a GitHub issue
      const doMatch = input.match(/^do\s+(\d+)$/i);
      if (doMatch) {
        const issueNumber = parseInt(doMatch[1], 10);
        await sendTyping();

        let issue;
        try {
          issue = getIssue(issueNumber);
        } catch (err) {
          await reply(`❌ Couldn't fetch issue #${issueNumber}: ${err.message.slice(0, 200)}`);
          return;
        }

        await reply(`🔨 Implementing: **${issue.title}**\n\nThis may take a minute...`);

        try {
          const response = await claude(buildImplementPrompt(issue));
          const summary = response.result || response.content || "Done.";
          const truncated = summary.length > 3500 ? summary.slice(0, 3500) + "\n\n...(truncated)" : summary;
          await reply(`✅ Implementation complete!\n\n${truncated}\n\nRun \`.ship\` when ready to commit and PR.`);
        } catch (err) {
          console.error("[feature] Implementation error:", err.message);
          await reply(`❌ Implementation failed: ${err.message.slice(0, 200)}`);
        }
        return;
      }

      const isNumber = /^\d+$/.test(input);
      const count = isNumber ? Math.min(parseInt(input, 10), 5) : 1;
      const specificIdea = !isNumber && input ? input : null;

      await sendTyping();
      if (specificIdea) {
        await reply(`📝 Writing up feature request for: "${specificIdea}"...`);
      } else {
        await reply(`🧠 Brainstorming ${count} feature idea${count > 1 ? "s" : ""}...`);
      }

      const existing = getExistingFeatures();

      let ideas;
      try {
        const prompt = specificIdea
          ? buildSpecificPrompt(specificIdea, existing)
          : buildBrainstormPrompt(count, existing);
        const response = await claude(prompt);
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
