import { spawn } from "child_process";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import config from "./config.js";

/**
 * Run a prompt through Codex CLI in non-interactive mode.
 * Returns plain-text result.
 */
export function runCodex(prompt, sessionId = null) {
  return new Promise((resolve, reject) => {
    const tempDir = mkdtempSync(join(tmpdir(), "oyster-codex-"));
    const outFile = join(tempDir, "last-message.txt");

    const args = [
      "exec",
      "--color", "never",
      "--output-last-message", outFile,
    ];

    if (config.codex.model) {
      args.push("--model", config.codex.model);
    }

    // Codex conversation resume mode differs from Claude; keep stateless for now.
    void sessionId;
    args.push(prompt);

    console.log(`[codex] spawning: ${config.codex.path} ${args.join(" ").slice(0, 120)}...`);

    const proc = spawn(config.codex.path, args, {
      env: {
        ...process.env,
        PATH: `${config.codex.extraPath}:${process.env.PATH || ""}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`Codex timed out after ${config.codex.timeoutMs / 1000}s`));
    }, config.codex.timeoutMs);

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (text.trim()) console.log(`[codex stderr] ${text.trim()}`);
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      console.log(`[codex] exited with code ${code}`);

      try {
        if (code !== 0) {
          throw new Error(`Codex exited with code ${code}: ${stderr.slice(0, 500) || stdout.slice(0, 500)}`);
        }

        let resultText = "";
        try {
          resultText = readFileSync(outFile, "utf8").trim();
        } catch {
          resultText = stdout.trim();
        }

        resolve({
          result: resultText || "No response received",
          session_id: null,
        });
      } catch (err) {
        reject(err);
      } finally {
        try {
          rmSync(tempDir, { recursive: true, force: true });
        } catch {
          // Best-effort cleanup
        }
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
      console.error("[codex] spawn error:", err.message);
      reject(err);
    });
  });
}

export default { runCodex };
