/**
 * Admin Plugin
 * 
 * Provides administrative commands for managing the bot:
 *   .reload  - Hot reload all plugins without restarting
 *   .restart - Full process restart (requires PM2)
 *   .status  - Show bot status and loaded plugins
 *   .git     - Show git status
 *   .commit  - Stage all and commit with message
 *   .push    - Push to remote
 *   .pr      - Create pull request
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
  },
};
