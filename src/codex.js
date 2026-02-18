import { spawn } from "child_process";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import config from "./config.js";

function extractSessionIdFromEvent(event) {
  if (!event || typeof event !== "object") return null;

  const type = typeof event.type === "string" ? event.type.toLowerCase() : "";
  const directCandidates = [
    event.session_id,
    event.sessionId,
    event.session?.id,
    event.thread_id,
    event.threadId,
    event.thread?.id,
    event.result?.session_id,
    event.result?.sessionId,
    event.result?.session?.id,
    event.result?.thread_id,
    event.result?.threadId,
    event.result?.thread?.id,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  const payload = event.payload && typeof event.payload === "object" ? event.payload : null;
  if (payload) {
    const payloadCandidates = [
      payload.session_id,
      payload.sessionId,
      payload.session?.id,
      payload.session?.session_id,
      payload.thread_id,
      payload.threadId,
      payload.thread?.id,
    ];

    for (const candidate of payloadCandidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }

    if (type === "session_meta") {
      const payloadId = payload.id;
      if (typeof payloadId === "string" && payloadId.trim()) {
        return payloadId.trim();
      }
    }
  }

  return null;
}

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
      "--json",
      "--output-last-message", outFile,
    ];

    if (config.codex.model) {
      args.push("--model", config.codex.model);
    }

    if (sessionId) {
      args.push("resume", sessionId, prompt);
    } else {
      args.push(prompt);
    }

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
    let stdoutBuffer = "";
    let stderrBuffer = "";
    const timeout = setTimeout(() => {
      proc.kill("SIGTERM");
      finishReject(new Error(`Codex timed out after ${config.codex.timeoutMs / 1000}s`));
    }, config.codex.timeoutMs);
    let settled = false;
    let parsedSessionId = sessionId || null;
    let lastAssistantText = "";

    const finishResolve = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    function processJsonLine(line) {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line);
        const sessionFromEvent = extractSessionIdFromEvent(event);
        if (sessionFromEvent && sessionFromEvent !== parsedSessionId) {
          parsedSessionId = sessionFromEvent;
          console.log(`[codex] session: ${parsedSessionId}`);
        }
        if (
          event.type === "response_item" &&
          event.payload?.type === "message" &&
          event.payload?.role === "assistant"
        ) {
          const textBlocks = event.payload.content?.filter((block) => block.type === "output_text");
          if (textBlocks?.length) {
            lastAssistantText = textBlocks.map((block) => block.text).join("\n\n");
          }
        }
      } catch {
        // Ignore non-JSON lines
      }
    }

    function consumeJsonLines(text, isStderr = false) {
      if (isStderr) {
        stderrBuffer += text;
      } else {
        stdoutBuffer += text;
      }

      const lines = (isStderr ? stderrBuffer : stdoutBuffer).split(/\r?\n/);
      const remainder = lines.pop() || "";
      if (isStderr) {
        stderrBuffer = remainder;
      } else {
        stdoutBuffer = remainder;
      }

      for (const line of lines) {
        processJsonLine(line);
      }
    }

    proc.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      consumeJsonLines(text, false);
    });

    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (text.trim()) console.log(`[codex stderr] ${text.trim()}`);
      consumeJsonLines(text, true);
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      console.log(`[codex] exited with code ${code}`);

      try {
        if (code !== 0) {
          const combinedOutput = `${stderr}\n${stdout}`;
          const hasRolloutPathError =
            Boolean(sessionId) &&
            /state db missing rollout path|missing rollout path for thread/i.test(combinedOutput);

          if (hasRolloutPathError) {
            console.warn(
              `[codex] Resume failed for session ${sessionId}; retrying without resume.`
            );
            runCodex(prompt, null).then(finishResolve).catch(finishReject);
            return;
          }

          throw new Error(`Codex exited with code ${code}: ${stderr.slice(0, 500) || stdout.slice(0, 500)}`);
        }

        // Flush any remaining partial JSON lines.
        consumeJsonLines("\n", false);
        consumeJsonLines("\n", true);

        let resultText = "";
        try {
          resultText = readFileSync(outFile, "utf8").trim();
        } catch {
          resultText = lastAssistantText || stdout.trim() || stderr.trim();
        }

        finishResolve({
          result: resultText || "No response received",
          session_id: parsedSessionId,
        });
      } catch (err) {
        finishReject(err);
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
      finishReject(err);
    });
  });
}

export default { runCodex };
