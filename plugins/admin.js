/**
 * Admin Plugin
 * 
 * Provides administrative commands for managing the bot:
 *   .reload  - Hot reload all plugins without restarting
 *   .restart - Full process restart (requires PM2)
 *   .status  - Show bot status and loaded plugins
 * 
 * Git workflow:
 *   .git     - Show git status
 *   .branch  - Create and switch to new branch
 *   .commit  - Stage all and commit (auto-generates message)
 *   .push    - Push to remote
 *   .pr      - Create pull request (auto-generates description)
 *   .merge   - Merge PR and delete branch
 *   .ship    - All-in-one: branch → commit → push → PR → merge
 */

import { exec, execSync } from "child_process";
import { reloadPlugins } from "../src/plugin-loader.js";
import { runClaude } from "../src/claude.js";

const GIT_CWD = { cwd: process.cwd(), encoding: "utf8" };
const MAX_DIFF_CHARS = 8000; // Limit diff size for Claude prompt

/**
 * Parse arguments from a command message
 * e.g., ".commit fix the bug" -> ["fix", "the", "bug"]
 */
function parseArgs(msg) {
  const parts = (msg.text || "").trim().split(/\s+/);
  return parts.slice(1); // Remove the command itself
}

/**
 * Generate a branch name from a description or timestamp
 */
function generateBranchName(description) {
  if (description) {
    // Convert description to branch-friendly format
    return "feature/" + description
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 50);
  }
  // Fallback to timestamp
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `feature/update-${stamp}`;
}

export default {
  name: "admin",

  commands: {
    /**
     * Hot reload all plugins
     * Usage: .reload
     */
    async reload(msg, { reply }) {
      await reply("Reloading plugins...");
      
      try {
        const result = await reloadPlugins();
        
        if (result.success) {
          await reply(`Reloaded ${result.loaded.length} plugin(s): ${result.loaded.join(", ") || "none"}`);
        } else {
          await reply(
            `Reload completed with errors:\n` +
            `Loaded: ${result.loaded.join(", ") || "none"}\n` +
            `Errors: ${result.errors.join("; ")}`
          );
        }
      } catch (err) {
        await reply(`Reload failed: ${err.message}`);
      }
    },

    /**
     * Full process restart via PM2
     * Usage: .restart
     */
    async restart(msg, { reply }) {
      await reply("Restarting bot via PM2...");
      
      exec("pm2 restart oyster-bot", (error, stdout, stderr) => {
        if (error) {
          // If PM2 fails, the message won't be sent since we're restarting
          // But log it for debugging
          console.error("[admin] PM2 restart failed:", error.message);
          console.error("[admin] stderr:", stderr);
          // Try to notify - may not work if PM2 is not available
        }
        // If successful, the process will restart and this code won't complete
      });
    },

    /**
     * Show bot status
     * Usage: .status
     */
    async status(msg, { reply, config }) {
      const uptime = process.uptime();
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const seconds = Math.floor(uptime % 60);
      
      const memUsage = process.memoryUsage();
      const memMB = Math.round(memUsage.heapUsed / 1024 / 1024);
      
      await reply(
        `Bot Status:\n` +
        `• Uptime: ${hours}h ${minutes}m ${seconds}s\n` +
        `• Memory: ${memMB} MB\n` +
        `• Node: ${process.version}\n` +
        `• PID: ${process.pid}`
      );
    },

    /**
     * Show git status
     * Usage: .git
     */
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

    /**
     * Create and switch to a new branch
     * Usage: .branch [name]  - auto-generates name if not provided
     */
    async branch(msg, { reply }) {
      const args = parseArgs(msg);
      const name = generateBranchName(args.join(" "));
      
      try {
        const currentBranch = execSync("git branch --show-current", GIT_CWD).trim();
        
        // Already on a feature branch?
        if (!["main", "master"].includes(currentBranch)) {
          await reply(`Already on branch: ${currentBranch}`);
          return;
        }
        
        // Create and switch to new branch
        execSync(`git checkout -b ${name}`, GIT_CWD);
        await reply(`Created branch: ${name}`);
      } catch (e) {
        if (e.message.includes("already exists")) {
          // Branch exists, just switch to it
          execSync(`git checkout ${name}`, GIT_CWD);
          await reply(`Switched to existing branch: ${name}`);
        } else {
          await reply(`Branch error: ${e.message}`);
        }
      }
    },

    /**
     * Stage all changes and commit
     * Usage: .commit [message]  - auto-generates message if not provided
     */
    async commit(msg, { reply }) {
      try {
        // Stage all changes first
        execSync("git add -A", GIT_CWD);
        
        // Check if there's anything to commit
        const status = execSync("git status --porcelain", GIT_CWD).trim();
        if (!status) {
          await reply("Nothing to commit");
          return;
        }

        const args = parseArgs(msg);
        let message = args.join(" ");
        
        // Auto-generate message if not provided
        if (!message) {
          await reply("Generating commit message...");
          
          // Get diff for context
          let diff = execSync("git diff --staged", GIT_CWD);
          if (diff.length > MAX_DIFF_CHARS) {
            diff = diff.slice(0, MAX_DIFF_CHARS) + "\n... (truncated)";
          }
          
          const prompt = `Generate a concise git commit message (1 line, max 72 chars) for these changes. Follow conventional commits style (feat:, fix:, chore:, etc). Reply with ONLY the commit message, nothing else.\n\n${diff}`;
          
          try {
            const result = await runClaude(prompt);
            message = result.result?.trim() || "Update from Telegram";
            // Clean up any quotes or markdown Claude might add
            message = message.replace(/^["'`]+|["'`]+$/g, "").trim();
          } catch (e) {
            console.error("[admin] Failed to generate commit message:", e.message);
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

    /**
     * Push to remote
     * Usage: .push
     */
    async push(msg, { reply }) {
      try {
        const result = execSync("git push -u origin HEAD", GIT_CWD);
        await reply("Pushed to remote");
      } catch (e) {
        await reply(`Push failed: ${e.message}`);
      }
    },

    /**
     * Create pull request with auto-generated title and description
     * Usage: .pr [title]  - auto-generates description, optional custom title
     */
    async pr(msg, { reply }) {
      const args = parseArgs(msg);
      let title = args.join(" ");
      
      try {
        // Get base branch (usually main or master)
        let baseBranch = "main";
        try {
          execSync("git rev-parse --verify main", GIT_CWD);
        } catch {
          baseBranch = "master";
        }
        
        // Get current branch
        const currentBranch = execSync("git branch --show-current", GIT_CWD).trim();
        
        // Get diff and commits for context
        let diff = "";
        let commits = "";
        try {
          diff = execSync(`git diff ${baseBranch}...HEAD`, GIT_CWD);
          if (diff.length > MAX_DIFF_CHARS) {
            diff = diff.slice(0, MAX_DIFF_CHARS) + "\n... (truncated)";
          }
          commits = execSync(`git log ${baseBranch}..HEAD --oneline`, GIT_CWD);
        } catch {
          // Branch might not have diverged yet
          diff = execSync("git diff HEAD~1", GIT_CWD);
          commits = execSync("git log -3 --oneline", GIT_CWD);
        }
        
        await reply("Generating PR description...");
        
        // Generate title and body with Claude
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
          const result = await runClaude(prompt);
          const response = result.result?.trim() || "";
          
          // Parse title and body from response
          const titleMatch = response.match(/TITLE:\s*(.+)/);
          const bodyMatch = response.match(/BODY:\s*([\s\S]+)/);
          
          if (!title && titleMatch) {
            title = titleMatch[1].trim();
          }
          if (bodyMatch) {
            body = bodyMatch[1].trim();
          }
        } catch (e) {
          console.error("[admin] Failed to generate PR description:", e.message);
        }
        
        // Fall back to branch name as title if needed
        if (!title) {
          title = currentBranch.replace(/[-_]/g, " ").replace(/^(feature|fix|chore)\//, "");
        }
        
        // Create the PR
        let cmd = `gh pr create --title "${title.replace(/"/g, '\\"')}"`;
        if (body) {
          // Write body to temp file to avoid shell escaping issues
          const { writeFileSync, unlinkSync } = await import("fs");
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

    /**
     * Merge current PR and clean up branch
     * Usage: .merge [squash|rebase]  - defaults to squash
     */
    async merge(msg, { reply }) {
      const args = parseArgs(msg);
      const strategy = args[0]?.toLowerCase() || "squash";
      
      if (!["squash", "merge", "rebase"].includes(strategy)) {
        await reply("Usage: .merge [squash|merge|rebase]");
        return;
      }
      
      try {
        // Get current branch before merging
        const currentBranch = execSync("git branch --show-current", GIT_CWD).trim();
        
        // Check if we're on main/master
        if (["main", "master"].includes(currentBranch)) {
          await reply("Already on main branch - nothing to merge");
          return;
        }
        
        // Get base branch
        let baseBranch = "main";
        try {
          execSync("git rev-parse --verify main", GIT_CWD);
        } catch {
          baseBranch = "master";
        }
        
        await reply(`Merging PR (${strategy})...`);
        
        // Merge the PR and delete the remote branch
        execSync(`gh pr merge --${strategy} --delete-branch`, GIT_CWD);
        
        // Switch to base branch and pull
        execSync(`git checkout ${baseBranch}`, GIT_CWD);
        execSync("git pull", GIT_CWD);
        
        // Delete local branch
        try {
          execSync(`git branch -d ${currentBranch}`, GIT_CWD);
        } catch {
          // Branch might already be deleted or have unmerged changes
          execSync(`git branch -D ${currentBranch}`, GIT_CWD);
        }
        
        await reply(`Merged and deleted branch: ${currentBranch}\nNow on: ${baseBranch}`);
      } catch (e) {
        await reply(`Merge failed: ${e.message}`);
      }
    },

    /**
     * Ship it! Commit, push, create PR, merge - all in one
     * Auto-creates a branch if on main/master
     * Usage: .ship [branch-name]
     */
    async ship(msg, { reply }) {
      try {
        const args = parseArgs(msg);
        
        // Get current branch
        let currentBranch = execSync("git branch --show-current", GIT_CWD).trim();
        
        // Get base branch
        let baseBranch = "main";
        try {
          execSync("git rev-parse --verify main", GIT_CWD);
        } catch {
          baseBranch = "master";
        }
        
        // If on main/master, create a feature branch first
        if (["main", "master"].includes(currentBranch)) {
          // Check if there are changes to ship
          execSync("git add -A", GIT_CWD);
          const status = execSync("git status --porcelain", GIT_CWD).trim();
          
          if (!status) {
            await reply("Nothing to ship - no changes detected");
            return;
          }
          
          // Generate branch name from args or diff
          let branchName = args.join(" ");
          if (!branchName) {
            // Try to generate from staged diff
            let diff = execSync("git diff --staged --stat", GIT_CWD).trim();
            // Extract first changed file name as hint
            const firstFile = diff.split("\n")[0]?.split("|")[0]?.trim();
            if (firstFile) {
              branchName = firstFile.replace(/\.[^.]+$/, "").replace(/[/\\]/g, "-");
            }
          }
          
          currentBranch = generateBranchName(branchName);
          await reply(`🌿 Creating branch: ${currentBranch}`);
          execSync(`git checkout -b ${currentBranch}`, GIT_CWD);
        }
        
        // Step 1: Stage and check for changes
        execSync("git add -A", GIT_CWD);
        const status = execSync("git status --porcelain", GIT_CWD).trim();
        
        let hasNewCommit = false;
        if (status) {
          // Step 2: Generate commit message and commit
          await reply("📦 Generating commit message...");
          
          let diff = execSync("git diff --staged", GIT_CWD);
          if (diff.length > MAX_DIFF_CHARS) {
            diff = diff.slice(0, MAX_DIFF_CHARS) + "\n... (truncated)";
          }
          
          let commitMsg = "Update from Telegram";
          try {
            const prompt = `Generate a concise git commit message (1 line, max 72 chars) for these changes. Follow conventional commits style (feat:, fix:, chore:, etc). Reply with ONLY the commit message, nothing else.\n\n${diff}`;
            const result = await runClaude(prompt);
            commitMsg = result.result?.trim().replace(/^["'\`]+|["'\`]+$/g, "").trim() || commitMsg;
          } catch (e) {
            console.error("[admin] Failed to generate commit message:", e.message);
          }
          
          execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, GIT_CWD);
          await reply(`✓ Committed: ${commitMsg}`);
          hasNewCommit = true;
        } else {
          await reply("📦 No new changes to commit");
        }
        
        // Step 3: Push
        await reply("🚀 Pushing to remote...");
        execSync("git push -u origin HEAD", GIT_CWD);
        await reply("✓ Pushed");
        
        // Step 4: Check if PR already exists
        let prUrl = "";
        try {
          prUrl = execSync("gh pr view --json url -q .url", GIT_CWD).trim();
        } catch {
          // No PR exists yet
        }
        
        if (!prUrl) {
          // Step 5: Create PR with generated description
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

            const result = await runClaude(prompt);
            const response = result.result?.trim() || "";
            
            const titleMatch = response.match(/TITLE:\s*(.+)/);
            const bodyMatch = response.match(/BODY:\s*([\s\S]+)/);
            
            if (titleMatch) title = titleMatch[1].trim();
            if (bodyMatch) body = bodyMatch[1].trim();
          } catch (e) {
            console.error("[admin] Failed to generate PR description:", e.message);
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
        
        // Step 6: Merge
        await reply("🔀 Merging PR...");
        execSync("gh pr merge --squash --delete-branch", GIT_CWD);
        
        // Step 7: Cleanup
        execSync(`git checkout ${baseBranch}`, GIT_CWD);
        execSync("git pull", GIT_CWD);
        
        try {
          execSync(`git branch -d ${currentBranch}`, GIT_CWD);
        } catch {
          try {
            execSync(`git branch -D ${currentBranch}`, GIT_CWD);
          } catch {
            // Branch already deleted
          }
        }
        
        await reply(`🎉 Shipped! Merged ${currentBranch} → ${baseBranch}`);
      } catch (e) {
        await reply(`Ship failed: ${e.message}`);
      }
    },
  },
};
