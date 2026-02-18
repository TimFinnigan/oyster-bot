/**
 * Feature Request Plugin
 *
 * Takes a short feature idea and uses Claude to write it up as a full
 * GitHub issue, then opens it with the "feature-request" label.
 *
 * - .feature <idea> — Write up and open a GitHub feature request issue
 *
 * Requires: gh CLI authenticated and GITHUB_REPO set in .env (e.g. "owner/repo")
 */

const GITHUB_REPO = process.env.GITHUB_REPO || "TimFinnigan/oyster-bot";

function buildPrompt(idea) {
  return `You are a software product manager writing a GitHub feature request issue.

The user has submitted this feature idea:
"${idea}"

Write a clear, well-structured GitHub issue for this feature request. Include:
- A concise title (one line, no prefix like "Feature:" needed)
- A ## Summary section (2-3 sentences describing the feature)
- A ## Motivation section (why this would be useful)
- A ## Proposed Solution section (how it could work, with specifics)
- A ## Acceptance Criteria section (bulleted checklist of what "done" looks like)

Keep it practical and grounded. Don't over-engineer. Output ONLY valid JSON in this exact format, no other text:
{
  "title": "issue title here",
  "body": "full markdown body here"
}`;
}

export default {
  name: "feature",

  help: {
    feature: "Open a GitHub feature request issue (e.g. .feature add weather alerts)",
  },

  commands: {
    feature: async (msg, { reply, sendTyping, claude }) => {
      const input = msg.text.replace(/^\.feature\s*/i, "").trim();

      if (!input) {
        await reply("Usage: `.feature <idea>`\nExample: `.feature add weather alerts for rain`");
        return;
      }

      await sendTyping();
      await reply(`📝 Writing up feature request for: "${input}"...`);

      let title, body;

      try {
        const response = await claude(buildPrompt(input));
        const raw = response.result || response.content || "";

        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON found in response");

        const parsed = JSON.parse(jsonMatch[0]);
        title = parsed.title?.trim();
        body = parsed.body?.trim();

        if (!title || !body) throw new Error("Missing title or body in response");
      } catch (err) {
        console.error("[feature] Failed to generate issue:", err.message);
        await reply(`❌ Couldn't write up the feature request: ${err.message}`);
        return;
      }

      try {
        const { execSync } = await import("child_process");
        const { writeFileSync, unlinkSync } = await import("fs");
        const { tmpdir } = await import("os");
        const { join } = await import("path");

        const tmpFile = join(tmpdir(), `feature-request-${Date.now()}.md`);
        writeFileSync(tmpFile, body, "utf-8");

        const cmd = `gh issue create --repo ${GITHUB_REPO} --title ${JSON.stringify(title)} --body-file ${JSON.stringify(tmpFile)} --label "feature-request"`;
        const output = execSync(cmd, { encoding: "utf-8" }).trim();

        try { unlinkSync(tmpFile); } catch {}

        await reply(`✅ Feature request opened!\n\n**${title}**\n\n${output}`);
      } catch (err) {
        console.error("[feature] Failed to create GitHub issue:", err.message);
        await reply(`❌ Couldn't open GitHub issue: ${err.message.slice(0, 200)}`);
      }
    },
  },
};
