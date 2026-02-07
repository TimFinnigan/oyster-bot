import config from "./config.js";
import { runClaude } from "./claude.js";
import { runCodex } from "./codex.js";

export const SUPPORTED_AI_PROVIDERS = ["claude", "codex"];

export function normalizeProvider(provider) {
  const normalized = String(provider || "").toLowerCase().trim();
  return SUPPORTED_AI_PROVIDERS.includes(normalized) ? normalized : null;
}

export function getConfiguredProvider() {
  return normalizeProvider(config.ai.provider) || "claude";
}

export async function runAI(prompt, sessionId = null, provider = getConfiguredProvider()) {
  const resolvedProvider = normalizeProvider(provider);
  if (!resolvedProvider) {
    throw new Error(`Unsupported AI provider: ${provider}. Supported: ${SUPPORTED_AI_PROVIDERS.join(", ")}`);
  }

  if (resolvedProvider === "codex") {
    const result = await runCodex(prompt, sessionId);
    return { ...result, provider: resolvedProvider };
  }

  const result = await runClaude(prompt, sessionId);
  return { ...result, provider: resolvedProvider };
}

export default { runAI, normalizeProvider, getConfiguredProvider, SUPPORTED_AI_PROVIDERS };
