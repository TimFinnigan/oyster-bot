import { spawn } from "child_process";
import config from "./config.js";

function extractSessionIdFromEvent(event) {
  if (!event || typeof event !== "object") return null;
  const candidates = [
    event.session_id,
    event.sessionId,
    event.session?.id,
    event.result?.session_id,
    event.result?.sessionId,
    event.result?.session?.id,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

/**
 * Log a streaming event from Claude
 */
function logStreamEvent(event) {
  const type = event.type;
  
  switch (type) {
    case "assistant":
      // Assistant message with content blocks
      if (event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === "thinking") {
            console.log(`[claude thinking] ${block.thinking?.slice(0, 200)}...`);
          } else if (block.type === "text") {
            console.log(`[claude text] ${block.text?.slice(0, 200)}...`);
          } else if (block.type === "tool_use") {
            console.log(`[claude tool] ${block.name}: ${JSON.stringify(block.input).slice(0, 100)}...`);
          }
        }
      }
      break;
    case "content_block_start":
      if (event.content_block?.type === "thinking") {
        console.log(`[claude] thinking...`);
      } else if (event.content_block?.type === "tool_use") {
        console.log(`[claude] using tool: ${event.content_block.name}`);
      }
      break;
    case "result":
      console.log(`[claude] result received, session: ${event.session_id}`);
      break;
    default:
      // Log other event types briefly
      if (config.claude.verboseLogging) {
        console.log(`[claude event] ${type}`);
      }
  }
}

/**
 * Run a prompt through the Claude CLI in --print mode.
 * Returns parsed JSON result or raw text.
 */
export function runClaude(prompt, sessionId = null) {
  return new Promise((resolve, reject) => {
    const args = [
      "--print",
      "--verbose",
      "--output-format", "stream-json",
      "--max-budget-usd", String(config.claude.maxBudgetUsd),
      "--allowed-tools", ...config.claude.allowedTools,
    ];

    if (config.claude.dangerouslySkipPermissions) {
      args.push("--dangerously-skip-permissions");
    }

    if (config.claude.allowedDirectories) {
      for (const dir of config.claude.allowedDirectories) {
        args.push("--add-dir", dir);
      }
    }

    if (sessionId) {
      args.push("--resume", sessionId);
    }

    args.push("--", prompt);

    console.log(`[claude] spawning: ${config.claude.path} ${args.join(" ").slice(0, 100)}...`);

    const proc = spawn(config.claude.path, args, {
      env: {
        ...process.env,
        PATH: `${config.claude.extraPath}:${process.env.PATH || ""}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let stderrRaw = "";
    let finalResult = null;
    let parsedSessionId = sessionId || null;
    let webSearchTimer = null;
    let settled = false;

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

    const timeout = setTimeout(() => {
      proc.kill("SIGTERM");
      finishReject(new Error(`Claude timed out after ${config.claude.timeoutMs / 1000}s`));
    }, config.claude.timeoutMs);

    function clearWebSearchTimer() {
      if (webSearchTimer) {
        clearTimeout(webSearchTimer);
        webSearchTimer = null;
      }
    }

    function handleEvent(event) {
      logStreamEvent(event);
      const sessionFromEvent = extractSessionIdFromEvent(event);
      if (sessionFromEvent && sessionFromEvent !== parsedSessionId) {
        parsedSessionId = sessionFromEvent;
      }

      // Web search timeout: abandon if a web search tool takes too long
      // Claude CLI stream-json sends: assistant (with tool_use) -> user (tool result) -> assistant (response)
      if (config.claude.webSearchTimeoutMs) {
        if (event.type === "assistant" && event.message?.content) {
          // Check if this assistant message contains a WebSearch/WebFetch tool use
          const hasWebTool = event.message.content.some(
            (block) =>
              block.type === "tool_use" &&
              ["WebSearch", "WebFetch"].includes(block.name)
          );

          if (hasWebTool) {
            // Starting a web search/fetch - set the timeout
            clearWebSearchTimer();
            webSearchTimer = setTimeout(() => {
              console.log(`[claude] web search timed out after ${config.claude.webSearchTimeoutMs / 1000}s, killing process`);
              proc.kill("SIGTERM");
              finishReject(new Error(`Web search timed out after ${config.claude.webSearchTimeoutMs / 1000}s`));
            }, config.claude.webSearchTimeoutMs);
          }
        }
        // Clear timer when tool result comes back (user event) or final result
        if (event.type === "user" || event.type === "result") {
          clearWebSearchTimer();
        }
      }

      // Capture the final result
      if (event.type === "result") {
        finalResult = event;
      }
    }

    function consumeJsonLines(text, isStderr = false) {
      if (isStderr) {
        stderrBuffer += text;
      } else {
        stdoutBuffer += text;
      }

      const lines = (isStderr ? stderrBuffer : stdoutBuffer).split("\n");
      const remainder = lines.pop() || "";
      if (isStderr) {
        stderrBuffer = remainder;
      } else {
        stdoutBuffer = remainder;
      }

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          handleEvent(JSON.parse(line));
        } catch {
          // Not valid JSON, skip
        }
      }
    }

    proc.stdout.on("data", (chunk) => {
      consumeJsonLines(chunk.toString(), false);
    });

    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderrRaw += text;
      if (text.trim()) console.log(`[claude stderr] ${text.trim()}`);
      consumeJsonLines(text, true);
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      clearWebSearchTimer();
      console.log(`[claude] exited with code ${code}`);

      if (code !== 0) {
        finishReject(new Error(`Claude exited with code ${code}: ${stderrRaw.slice(0, 500)}`));
        return;
      }

      // Process any remaining partial buffers
      consumeJsonLines("\n", false);
      consumeJsonLines("\n", true);

      if (finalResult) {
        finishResolve({
          result: finalResult.result,
          session_id: extractSessionIdFromEvent(finalResult) || parsedSessionId,
          cost_usd: finalResult.cost_usd,
          duration_ms: finalResult.duration_ms,
        });
      } else {
        finishResolve({ result: "No response received", session_id: parsedSessionId });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      clearWebSearchTimer();
      console.error(`[claude] spawn error:`, err.message);
      finishReject(err);
    });
  });
}

export default { runClaude };
