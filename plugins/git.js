/**
 * Git Plugin
 *
 * Git workflow commands:
 *   .changes - Summarize uncommitted changes using Claude
 *   .git     - Show git status
 *   .branch  - Create and switch to new branch
 *   .commit  - Stage all and commit (auto-generates message)
 *   .push    - Push to remote
 *   .pr      - Create pull request (auto-generates description)
 *   .merge   - Merge PR and delete branch
 *   .ship    - All-in-one: branch → commit → push → PR → merge
 */

import { execSync } from "child_process";

const GIT_CWD = { cwd: process.cwd(), encoding: "utf8" };
const MAX_DIFF_CHARS = 8000;

let codexFallbackRunner = null;

async function runPromptWithFallback(prompt, claudeFn, reply, context = "processing your request") {
  try {
    return await claudeFn(prompt);
  } catch (error) {
    const message = error?.message || "";
    const shouldFailover = message.includes("Claude exited with code 1");

    if (!shouldFailover) {
      throw error;
    }

    console.warn(`[git] Claude crashed during ${context}: ${message}`);
    if (reply) {
      await reply(`Claude crashed while ${context}. Falling back to Codex...`);
    }

    try {
      if (!codexFallbackRunner) {
        const { runAI } = await import("../src/ai.js");
        codexFallbackRunner = (prompt, sessionId = null) => runAI(prompt, sessionId, "codex");
      }
      return await codexFallbackRunner(prompt);
    } catch (fallbackError) {
      const fallbackMessage = fallbackError?.message || fallbackError?.toString() || "unknown Codex error";
      throw new Error(`${message} (Codex fallback failed: ${fallbackMessage})`);
    }
  }
}

function deleteLocalBranchIfExists(branch) {
  try {
    execSync(`git show-ref --verify --quiet refs/heads/${branch}`, GIT_CWD);
  } catch {
    return;
  }

  try {
    execSync(`git branch -d ${branch}`, GIT_CWD);
  } catch {
    execSync(`git branch -D ${branch}`, GIT_CWD);
  }
}

function parseArgs(msg) {
  const parts = (msg.text || "").trim().split(/\s+/);
  return parts.slice(1);
}

function generateBranchName(description) {
  if (description) {
    return "feature/" + description
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 50);
  }
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `feature/update-${stamp}`;
}

export default {
  name: "git",

  help: {
    changes: "Summarize uncommitted git changes",
    git: "Show git status",
    branch: "Create and switch to a new branch",
    commit: "Stage all and commit (auto-generates message)",
    push: "Push to remote",
    pr: "Create a pull request",
    merge: "Merge current PR and clean up",
    ship: "All-in-one: branch, commit, push, PR, merge",
  },

  commands: {
    async changes(msg, { reply, sendTyping, claude }) {
      try {
        const status = execSync("git status --short", GIT_CWD).trim();
        if (!status) {
          await reply("No uncommitted changes.");
          return;
        }

        await sendTyping();

        let diff = execSync("git diff", GIT_CWD) + execSync("git diff --staged", GIT_CWD);
        if (diff.length > MAX_DIFF_CHARS) {
          diff = diff.slice(0, MAX_DIFF_CHARS) + "\n... (truncated)";
        }

        const branch = execSync("git branch --show-current", GIT_CWD).trim();

        const result = await runPromptWithFallback(
          `Summarize these uncommitted git changes in a concise, readable way. Group by theme (e.g. new features, bug fixes, refactors). Use bullet points. Keep it short — this is for a quick Telegram status update.\n\nBranch: ${branch}\n\nFiles changed:\n${status}\n\nDiff:\n${diff}`,
          claude,
          reply,
          "summarizing git changes"
        );

        const summary = result.result?.trim() || "Could not generate summary.";
        await reply(`📝 Changes on ${branch}:\n\n${summary}`);
      } catch (err) {
        await reply(`Error: ${err.message.slice(0, 200)}`);
      }
    },

    async git(msg, { reply }) {
      try {
        const status = execSync("git status --short", GIT_CWD);
        const branch = execSync("git branch --show-current", GIT_CWD).trim();

        if (!status.trim()) {
          await reply(`On branch: ${branch}\nNo changes`);
        } else {
          await reply(`On branch: ${branch}\n\`\`\`\n${status.trim()}\n\`\`\``);
        }
      } catch (e) {
        await reply(`Git error: ${e.message}`);
      }
    },

    async branch(msg, { reply, claude }) {
      const args = parseArgs(msg);
      let name = args.join(" ");

      try {
        const currentBranch = execSync("git branch --show-current", GIT_CWD).trim();

        if (!["main", "master"].includes(currentBranch)) {
          await reply(`Already on branch: ${currentBranch}`);
          return;
        }

        if (!name) {
          const status = execSync("git status --porcelain", GIT_CWD).trim();

          if (status) {
            await reply("Generating branch name...");
            let diff = execSync("git diff", GIT_CWD) || execSync("git diff --staged", GIT_CWD);
            if (diff.length > MAX_DIFF_CHARS) {
              diff = diff.slice(0, MAX_DIFF_CHARS) + "\n... (truncated)";
            }

            try {
              const prompt = `Generate a short git branch name for these changes. Use format: type/short-description where type is feat, fix, chore, refactor, or docs. Keep the description to 2-4 words max, lowercase, hyphenated. Reply with ONLY the branch name, nothing else.\n\nExample good names: feat/add-user-auth, fix/login-redirect, chore/update-deps\n\nChanges:\n${diff}`;
              const result = await runPromptWithFallback(prompt, claude, reply, "generating a branch name");
              name = result.result?.trim().replace(/^["'\\`]+|["'\\`]+$/g, "").trim();
              name = name?.replace(/[^a-zA-Z0-9/_-]/g, "").slice(0, 50);
            } catch (e) {
              console.error("[git] Failed to generate branch name:", e.message);
            }
          }

          if (!name) {
            const now = new Date();
            const stamp = now.toISOString().slice(0, 10).replace(/-/g, "");
            name = `feature/update-${stamp}`;
          } else if (!name.includes("/")) {
            name = `feature/${name}`;
          }
        } else {
          name = generateBranchName(name);
        }

        execSync(`git checkout -b ${name}`, GIT_CWD);
        await reply(`Created branch: ${name}`);
      } catch (e) {
        if (e.message.includes("already exists")) {
          execSync(`git checkout ${name}`, GIT_CWD);
          await reply(`Switched to existing branch: ${name}`);
        } else {
          await reply(`Branch error: ${e.message}`);
        }
      }
    },

    async commit(msg, { reply, claude }) {
      try {
        execSync("git add -A", GIT_CWD);

        const status = execSync("git status --porcelain", GIT_CWD).trim();
        if (!status) {
          await reply("Nothing to commit");
          return;
        }

        const args = parseArgs(msg);
        let message = args.join(" ");

        if (!message) {
          await reply("Generating commit message...");

          let diff = execSync("git diff --staged", GIT_CWD);
          if (diff.length > MAX_DIFF_CHARS) {
            diff = diff.slice(0, MAX_DIFF_CHARS) + "\n... (truncated)";
          }

          const prompt = `Generate a concise git commit message (1 line, max 72 chars) for these changes. Follow conventional commits style (feat:, fix:, chore:, etc). Reply with ONLY the commit message, nothing else.\n\n${diff}`;

          try {
            const result = await runPromptWithFallback(prompt, claude, reply, "generating a commit message");
            message = result.result?.trim() || "Update from Telegram";
            message = message.replace(/^["'`]+|["'`]+$/g, "").trim();
          } catch (e) {
            console.error("[git] Failed to generate commit message:", e.message);
            message = "Update from Telegram";
          }
        }

        execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, GIT_CWD);
        await reply(`Committed: ${message}`);
      } catch (e) {
        if (e.message.includes("nothing to commit")) {
          await reply("Nothing to commit");
        } else {
          await reply(`Commit failed: ${e.message}`);
        }
      }
    },

    async push(msg, { reply }) {
      try {
        execSync("git push -u origin HEAD", GIT_CWD);
        await reply("Pushed to remote");
      } catch (e) {
        await reply(`Push failed: ${e.message}`);
      }
    },

    async pr(msg, { reply, claude }) {
      const args = parseArgs(msg);
      let title = args.join(" ");

      try {
        let baseBranch = "main";
        try {
          execSync("git rev-parse --verify main", GIT_CWD);
        } catch {
          baseBranch = "master";
        }

        const currentBranch = execSync("git branch --show-current", GIT_CWD).trim();

        let diff = "";
        let commits = "";
        try {
          diff = execSync(`git diff ${baseBranch}...HEAD`, GIT_CWD);
          if (diff.length > MAX_DIFF_CHARS) {
            diff = diff.slice(0, MAX_DIFF_CHARS) + "\n... (truncated)";
          }
          commits = execSync(`git log ${baseBranch}..HEAD --oneline`, GIT_CWD);
        } catch {
          diff = execSync("git diff HEAD~1", GIT_CWD);
          commits = execSync("git log -3 --oneline", GIT_CWD);
        }

        await reply("Generating PR description...");

        const prompt = `Generate a GitHub pull request title and description for these changes.

Branch: ${currentBranch}
Commits:
${commits}

Diff:
${diff}

Reply in this exact format (no other text):
TITLE: <concise title, max 72 chars>
BODY:
<markdown description with:
- Summary (1-2 sentences)
- Key changes (bullet points)
- Any notes for reviewers>`;

        let body = "";
        try {
          const result = await runPromptWithFallback(prompt, claude, reply, "drafting the PR description");
          const response = result.result?.trim() || "";

          const titleMatch = response.match(/TITLE:\s*(.+)/);
          const bodyMatch = response.match(/BODY:\s*([\s\S]+)/);

          if (!title && titleMatch) {
            title = titleMatch[1].trim();
          }
          if (bodyMatch) {
            body = bodyMatch[1].trim();
          }
        } catch (e) {
          console.error("[git] Failed to generate PR description:", e.message);
        }

        if (!title) {
          title = currentBranch.replace(/[-_]/g, " ").replace(/^(feature|fix|chore)\//, "");
        }

        let cmd = `gh pr create --title "${title.replace(/"/g, '\\"')}"`;
        if (body) {
          const { writeFileSync } = await import("fs");
          const bodyFile = "/tmp/pr-body.md";
          writeFileSync(bodyFile, body);
          cmd += ` --body-file "${bodyFile}"`;
        } else {
          cmd += " --fill";
        }

        const result = execSync(cmd, GIT_CWD);
        await reply(`PR created: ${result.trim()}`);
      } catch (e) {
        if (e.message.includes("already exists")) {
          await reply("PR already exists for this branch");
        } else {
          await reply(`PR failed: ${e.message}`);
        }
      }
    },

    async merge(msg, { reply }) {
      const args = parseArgs(msg);
      const strategy = args[0]?.toLowerCase() || "squash";

      if (!["squash", "merge", "rebase"].includes(strategy)) {
        await reply("Usage: .merge [squash|merge|rebase]");
        return;
      }

      try {
        const currentBranch = execSync("git branch --show-current", GIT_CWD).trim();

        if (["main", "master"].includes(currentBranch)) {
          await reply("Already on main branch - nothing to merge");
          return;
        }

        let baseBranch = "main";
        try {
          execSync("git rev-parse --verify main", GIT_CWD);
        } catch {
          baseBranch = "master";
        }

        await reply(`Merging PR (${strategy})...`);

        execSync(`gh pr merge ${currentBranch} --${strategy} --delete-branch`, GIT_CWD);

        execSync(`git checkout ${baseBranch}`, GIT_CWD);
        execSync("git pull", GIT_CWD);

        deleteLocalBranchIfExists(currentBranch);

        await reply(`Merged and deleted branch: ${currentBranch}\nNow on: ${baseBranch}`);
      } catch (e) {
        await reply(`Merge failed: ${e.message}`);
      }
    },

    async ship(msg, { reply, claude }) {
      try {
        const args = parseArgs(msg);

        let currentBranch = execSync("git branch --show-current", GIT_CWD).trim();

        let baseBranch = "main";
        try {
          execSync("git rev-parse --verify main", GIT_CWD);
        } catch {
          baseBranch = "master";
        }

        if (["main", "master"].includes(currentBranch)) {
          execSync("git add -A", GIT_CWD);
          const status = execSync("git status --porcelain", GIT_CWD).trim();

          if (!status) {
            await reply("Nothing to ship - no changes detected");
            return;
          }

          let branchName = args.join(" ");
          if (!branchName) {
            await reply("🌿 Generating branch name...");

            let diff = execSync("git diff --staged", GIT_CWD);
            if (diff.length > MAX_DIFF_CHARS) {
              diff = diff.slice(0, MAX_DIFF_CHARS) + "\n... (truncated)";
            }

            try {
              const prompt = `Generate a short git branch name for these changes. Use format: type/short-description where type is feat, fix, chore, refactor, or docs. Keep the description to 2-4 words max, lowercase, hyphenated. Reply with ONLY the branch name, nothing else.\n\nExample good names: feat/add-user-auth, fix/login-redirect, chore/update-deps, docs/api-reference\n\nChanges:\n${diff}`;
              const result = await runPromptWithFallback(prompt, claude, reply, "generating a branch name");
              branchName = result.result?.trim().replace(/^["'\\`]+|["'\\`]+$/g, "").trim();
              branchName = branchName?.replace(/[^a-zA-Z0-9/_-]/g, "").slice(0, 50);
            } catch (e) {
              console.error("[git] Failed to generate branch name:", e.message);
            }
          }

          if (!branchName) {
            const now = new Date();
            const stamp = now.toISOString().slice(0, 10).replace(/-/g, "");
            branchName = `feature/update-${stamp}`;
          } else if (!branchName.includes("/")) {
            branchName = `feature/${branchName}`;
          }

          currentBranch = branchName;
          await reply(`🌿 Creating branch: ${currentBranch}`);
          execSync(`git checkout -b ${currentBranch}`, GIT_CWD);
        }

        execSync("git add -A", GIT_CWD);
        const status = execSync("git status --porcelain", GIT_CWD).trim();

        if (status) {
          await reply("📦 Generating commit message...");

          let diff = execSync("git diff --staged", GIT_CWD);
          if (diff.length > MAX_DIFF_CHARS) {
            diff = diff.slice(0, MAX_DIFF_CHARS) + "\n... (truncated)";
          }

          let commitMsg = "Update from Telegram";
          try {
            const prompt = `Generate a concise git commit message (1 line, max 72 chars) for these changes. Follow conventional commits style (feat:, fix:, chore:, etc). Reply with ONLY the commit message, nothing else.\n\n${diff}`;
            const result = await runPromptWithFallback(prompt, claude, reply, "generating a commit message");
            commitMsg = result.result?.trim().replace(/^["'\\`]+|["'\\`]+$/g, "").trim() || commitMsg;
          } catch (e) {
            console.error("[git] Failed to generate commit message:", e.message);
          }

          execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, GIT_CWD);
          await reply(`✓ Committed: ${commitMsg}`);
        } else {
          await reply("📦 No new changes to commit");
        }

        await reply("🚀 Pushing to remote...");
        execSync("git push -u origin HEAD", GIT_CWD);
        await reply("✓ Pushed");

        let prUrl = "";
        try {
          prUrl = execSync(`gh pr view ${currentBranch} --json url -q .url`, GIT_CWD).trim();
        } catch {
          // No PR exists yet
        }

        if (!prUrl) {
          await reply("📝 Generating PR description...");

          let diff = "";
          let commits = "";
          try {
            diff = execSync(`git diff ${baseBranch}...HEAD`, GIT_CWD);
            if (diff.length > MAX_DIFF_CHARS) {
              diff = diff.slice(0, MAX_DIFF_CHARS) + "\n... (truncated)";
            }
            commits = execSync(`git log ${baseBranch}..HEAD --oneline`, GIT_CWD);
          } catch {
            diff = execSync("git diff HEAD~1", GIT_CWD);
            commits = execSync("git log -3 --oneline", GIT_CWD);
          }

          let title = currentBranch.replace(/[-_]/g, " ").replace(/^(feature|fix|chore)\//, "");
          let body = "";

          try {
            const prompt = `Generate a GitHub pull request title and description for these changes.

Branch: ${currentBranch}
Commits:
${commits}

Diff:
${diff}

Reply in this exact format (no other text):
TITLE: <concise title, max 72 chars>
BODY:
<markdown description with:
- Summary (1-2 sentences)
- Key changes (bullet points)
- Any notes for reviewers>`;

            const result = await runPromptWithFallback(prompt, claude, reply, "drafting the PR description");
            const response = result.result?.trim() || "";

            const titleMatch = response.match(/TITLE:\s*(.+)/);
            const bodyMatch = response.match(/BODY:\s*([\s\S]+)/);

            if (titleMatch) title = titleMatch[1].trim();
            if (bodyMatch) body = bodyMatch[1].trim();
          } catch (e) {
            console.error("[git] Failed to generate PR description:", e.message);
          }

          let cmd = `gh pr create --title "${title.replace(/"/g, '\\"')}"`;
          if (body) {
            const { writeFileSync } = await import("fs");
            const bodyFile = "/tmp/pr-body.md";
            writeFileSync(bodyFile, body);
            cmd += ` --body-file "${bodyFile}"`;
          } else {
            cmd += " --fill";
          }

          prUrl = execSync(cmd, GIT_CWD).trim();
          await reply(`✓ PR created: ${prUrl}`);
        } else {
          await reply(`✓ PR exists: ${prUrl}`);
        }

        await reply("🔀 Merging PR...");
        execSync(`gh pr merge ${currentBranch} --squash --delete-branch`, GIT_CWD);

        execSync(`git checkout ${baseBranch}`, GIT_CWD);
        execSync("git pull", GIT_CWD);

        deleteLocalBranchIfExists(currentBranch);

        await reply(`🎉 Shipped! Merged ${currentBranch} → ${baseBranch}`);
      } catch (e) {
        await reply(`Ship failed: ${e.message}`);
      }
    },
  },
};
