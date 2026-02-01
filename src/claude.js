import { spawn } from "child_process";
import config from "./config.js";

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

    let buffer = "";
    let stderr = "";
    let finalResult = null;
    let webSearchTimer = null;

    const timeout = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`Claude timed out after ${config.claude.timeoutMs / 1000}s`));
    }, config.claude.timeoutMs);

    function clearWebSearchTimer() {
      if (webSearchTimer) {
        clearTimeout(webSearchTimer);
        webSearchTimer = null;
      }
    }

    proc.stdout.on("data", (chunk) => {
      buffer += chunk.toString();

      // Process complete JSON lines
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          logStreamEvent(event);

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
                  reject(new Error(`Web search timed out after ${config.claude.webSearchTimeoutMs / 1000}s`));
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
        } catch {
          // Not valid JSON, skip
        }
      }
    });

    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (text.trim()) console.log(`[claude stderr] ${text.trim()}`);
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      clearWebSearchTimer();
      console.log(`[claude] exited with code ${code}`);

      if (code !== 0) {
        reject(new Error(`Claude exited with code ${code}: ${stderr.slice(0, 500)}`));
        return;
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer);
          if (event.type === "result") {
            finalResult = event;
          }
        } catch {
          // ignore
        }
      }

      if (finalResult) {
        resolve({
          result: finalResult.result,
          session_id: finalResult.session_id,
          cost_usd: finalResult.cost_usd,
          duration_ms: finalResult.duration_ms,
        });
      } else {
        resolve({ result: "No response received", session_id: sessionId });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      clearWebSearchTimer();
      console.error(`[claude] spawn error:`, err.message);
      reject(err);
    });
  });
}

export default { runClaude };
