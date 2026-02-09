import { config as loadEnv } from "dotenv";
import { homedir } from "os";
import { dirname, join, resolve, isAbsolute } from "path";
import { fileURLToPath } from "url";
import { getDataDir, getPluginDirs } from "./runtime-paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__dirname, "..", ".env") });
const dataDir = getDataDir();

function resolveMediaDirOverride(value) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) {
    return join(homedir(), trimmed.slice(2));
  }
  return isAbsolute(trimmed) ? trimmed : resolve(__dirname, "..", trimmed);
}

function resolveTelegramMediaDir() {
  return resolveMediaDirOverride(process.env.TELEGRAM_MEDIA_DIR) || join(dataDir, "telegram-media");
}

function resolveTelegramMediaMaxBytes() {
  const bytesEnv = Number(process.env.TELEGRAM_MEDIA_MAX_BYTES);
  if (!Number.isNaN(bytesEnv) && bytesEnv > 0) {
    return bytesEnv;
  }
  const mb = Number(process.env.TELEGRAM_MEDIA_MAX_MB);
  const fallbackMb = !Number.isNaN(mb) && mb > 0 ? mb : 15;
  return Math.round(fallbackMb * 1024 * 1024);
}

const telegramMediaDir = resolveTelegramMediaDir();
const telegramMediaMaxBytes = resolveTelegramMediaMaxBytes();

/**
 * Parse allowed user IDs from env (supports numbers for Telegram, strings for others)
 */
function parseAllowedUserIds(envVar) {
  if (!envVar) return null;
  return envVar.split(",").map((id) => id.trim());
}

/**
 * Bot configuration with environment variable overrides
 * 
 * Channels are configured under the `channels` key.
 * Each channel has an `enabled` flag and channel-specific settings.
 */
export const config = {
  // Channel configurations
  channels: {
    telegram: {
      enabled: !!process.env.TELEGRAM_BOT_TOKEN,
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      handlerTimeout: Number(process.env.HANDLER_TIMEOUT_MS) || 300_000, // 5 minutes
      maxMessageLength: Number(process.env.MAX_MESSAGE_LENGTH) || 4096,
      mediaDir: telegramMediaDir,
      maxAttachmentBytes: telegramMediaMaxBytes,
      // Per-channel auth (uses numeric IDs for Telegram)
      allowedUserIds: process.env.ALLOWED_USER_IDS
        ? process.env.ALLOWED_USER_IDS.split(",").map((id) => Number(id.trim()))
        : null,
    },
    // Future channels can be added here:
    // discord: {
    //   enabled: !!process.env.DISCORD_BOT_TOKEN,
    //   botToken: process.env.DISCORD_BOT_TOKEN,
    //   allowedUserIds: parseAllowedUserIds(process.env.DISCORD_ALLOWED_USER_IDS),
    // },
    // slack: {
    //   enabled: !!process.env.SLACK_BOT_TOKEN,
    //   botToken: process.env.SLACK_BOT_TOKEN,
    //   appToken: process.env.SLACK_APP_TOKEN,
    //   allowedUserIds: parseAllowedUserIds(process.env.SLACK_ALLOWED_USER_IDS),
    // },
  },

  media: {
    telegram: {
      dir: telegramMediaDir,
      maxAttachmentBytes: telegramMediaMaxBytes,
    },
  },

  // Global settings
  maxMessageLength: Number(process.env.MAX_MESSAGE_LENGTH) || 4096,
  ai: {
    provider: (process.env.AI_PROVIDER || "claude").toLowerCase(),
  },

  // Claude CLI
  claude: {
    path: process.env.CLAUDE_PATH || "claude",
    timeoutMs: Number(process.env.CLAUDE_TIMEOUT_MS) || 120_000, // 2 minutes
    maxBudgetUsd: Number(process.env.CLAUDE_MAX_BUDGET_USD) || 1,
    allowedTools: (process.env.CLAUDE_ALLOWED_TOOLS || "Read,Glob,Grep,WebSearch,WebFetch")
      .split(",")
      .map((t) => t.trim()),
    extraPath: process.env.CLAUDE_EXTRA_PATH || "/usr/local/bin:/opt/homebrew/bin",
    dangerouslySkipPermissions: process.env.CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS === "true",
    verboseLogging: process.env.CLAUDE_VERBOSE_LOGGING === "true",
    webSearchTimeoutMs: process.env.WEB_SEARCH_TIMEOUT_MS
      ? Number(process.env.WEB_SEARCH_TIMEOUT_MS)
      : null, // null = no separate web search timeout
    allowedDirectories: process.env.CLAUDE_ALLOWED_DIRECTORIES
      ? process.env.CLAUDE_ALLOWED_DIRECTORIES.split(",").map((d) => d.trim())
      : null,
  },

  // Codex CLI
  codex: {
    path: process.env.CODEX_PATH || "codex",
    timeoutMs: Number(process.env.CODEX_TIMEOUT_MS) || 180_000, // 3 minutes
    model: process.env.CODEX_MODEL || null,
    extraPath: process.env.CODEX_EXTRA_PATH || "/usr/local/bin:/opt/homebrew/bin",
  },

  // Runtime paths
  paths: {
    dataDir: getDataDir(),
    pluginDirs: getPluginDirs(),
  },

  // Plugins
  plugins: {
    // Chat ID to send scheduled plugin messages to (e.g., your user ID)
    targetChatId: process.env.PLUGIN_TARGET_CHAT_ID
      ? Number(process.env.PLUGIN_TARGET_CHAT_ID)
      : null,
    // Which channel to use for scheduled messages (default: telegram)
    targetChannel: process.env.PLUGIN_TARGET_CHANNEL || "telegram",
    // Weather plugin default location
    weatherDefaultLocation: process.env.WEATHER_DEFAULT_LOCATION || null,
    // Temperature units: "fahrenheit" or "celsius"
    weatherUnits: process.env.WEATHER_UNITS || "fahrenheit",
  },

  // Legacy access for backward compatibility
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    handlerTimeout: Number(process.env.HANDLER_TIMEOUT_MS) || 300_000,
    maxMessageLength: Number(process.env.MAX_MESSAGE_LENGTH) || 4096,
  },
  auth: {
    allowedUserIds: process.env.ALLOWED_USER_IDS
      ? process.env.ALLOWED_USER_IDS.split(",").map((id) => Number(id.trim()))
      : null,
  },
};

// Validate at least one channel is configured
const enabledChannels = Object.entries(config.channels).filter(([, c]) => c.enabled);
if (enabledChannels.length === 0) {
  throw new Error("No channels configured. Set TELEGRAM_BOT_TOKEN (or another channel token) in environment.");
}

export default config;
