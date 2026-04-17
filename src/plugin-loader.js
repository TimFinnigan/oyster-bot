import { readdirSync, existsSync, readFileSync, writeFileSync, statSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import cron from "node-cron";
import { getDataDir, getPluginDirs } from "./runtime-paths.js";
import { isPluginEnabled } from "./plugin-settings.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BUSINESS_IDEAS_OUTPUT_DIR = join(__dirname, "..", "..", "business-ideas");

/**
 * Plugin Loader (Channel-Agnostic)
 * 
 * Auto-discovers and loads plugins from the plugins/ directory.
 * Plugins can provide:
 *   - init: async ({ channels, config, claude }) => {} — runs once at startup
 *   - commands: { commandName: async (msg, { reply, claude, config, channel }) => {} }
 *   - schedules: [{ cron: '0 * * * *', handler: async ({ channels, config, claude }) => {} }]
 *   - onMessage: async (msg, { reply, claude, config, channel }) => boolean
 * 
 * Note: Plugin commands use . prefix (e.g., .food) to avoid conflicts with Claude's slash commands.
 * 
 * The `msg` object is a unified Message (see types/message.js).
 * The `reply` helper sends a response back through the appropriate channel.
 */

// Collected command handlers from plugins: commandName -> { handler, pluginName, description }
const commandHandlers = new Map();
// Collected message handlers from plugins
const messageHandlers = [];
// Track scheduled tasks so we can stop them on reload
const scheduledTasks = [];
// Track schedule metadata for introspection (plugin name + cron expression)
const scheduleRegistry = [];
// Track plugin destroy functions for cleanup on reload
const destroyHandlers = [];
// Notification registry: plugins register active notifications for cross-plugin visibility
// Map<string, { pluginName, label, type, nextAt?, meta? }>
const notificationRegistry = new Map();
// All loaded plugin names (for the plugins management command)
const loadedPluginNames = new Set();
let businessIdeasReconcileInterval = null;
let lastBusinessIdeasReconcileAt = 0;

// Store references for use in handlers
let _runClaude, _config, _channels;

function loadJsonArray(filePath) {
  try {
    if (!existsSync(filePath)) return [];
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error(`[plugins] Failed to read JSON array from ${filePath}:`, err.message);
    return [];
  }
}

function mergeSuggestionArrays(arrays) {
  const merged = [];
  const seen = new Set();
  for (const list of arrays) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const key = JSON.stringify({
        name: item.name || "",
        description: item.description || "",
        complexity: item.complexity || "",
        suggestedAt: item.suggestedAt || "",
      });
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  merged.sort((a, b) => {
    const at = new Date(a?.suggestedAt || 0).getTime();
    const bt = new Date(b?.suggestedAt || 0).getTime();
    return at - bt;
  });
  return merged;
}

function reconcileEvolveSuggestions(sourcePluginPath = null) {
  try {
    const targetFile = join(getDataDir(_config), "evolve-suggestions.json");
    const candidateFiles = [targetFile];

    if (sourcePluginPath) {
      const sourceFile = join(dirname(sourcePluginPath), "..", "..", "data", "evolve-suggestions.json");
      if (!candidateFiles.includes(sourceFile)) {
        candidateFiles.push(sourceFile);
      }
    }

    const merged = mergeSuggestionArrays(candidateFiles.map((file) => loadJsonArray(file)));
    const current = loadJsonArray(targetFile);

    if (JSON.stringify(current) !== JSON.stringify(merged)) {
      mkdirSync(dirname(targetFile), { recursive: true });
      writeFileSync(targetFile, JSON.stringify(merged, null, 2));
      console.log(`[plugins] Reconciled evolve suggestions (${merged.length} ideas)`);
    }
  } catch (err) {
    console.error("[plugins] Evolve suggestions reconcile failed:", err.message);
  }
}

function normalizeIdea(idea) {
  return {
    name: idea?.name || "",
    tagline: idea?.tagline || "",
    problem: idea?.problem || "",
    solution: idea?.solution || "",
    features: Array.isArray(idea?.features) ? idea.features : [],
    audience: idea?.audience || "",
    revenueModel: idea?.revenueModel || "",
    niche: idea?.niche || "general",
    heroGradient: Array.isArray(idea?.heroGradient) ? idea.heroGradient : undefined,
    accentColor: idea?.accentColor,
    slug: idea?.slug || "",
    createdAt: idea?.createdAt || "",
    path: idea?.path || "",
  };
}

function reconcileBusinessIdeas({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastBusinessIdeasReconcileAt < 15_000) return;
  lastBusinessIdeasReconcileAt = now;

  try {
    const businessIdeasOutputDir = _config?.paths?.businessIdeasOutputDir || process.env.BUSINESS_IDEAS_OUTPUT_DIR || DEFAULT_BUSINESS_IDEAS_OUTPUT_DIR;
    const businessIdeasFile = join(getDataDir(_config), "business-ideas.json");

    if (!existsSync(businessIdeasOutputDir)) return;

    const existing = loadJsonArray(businessIdeasFile);
    const existingBySlug = new Map(
      existing
        .filter((idea) => idea && typeof idea.slug === "string" && idea.slug.length > 0)
        .map((idea) => [idea.slug, idea])
    );

    const dirs = readdirSync(businessIdeasOutputDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    const rebuilt = [];
    for (const slug of dirs) {
      const ideaJsonPath = join(businessIdeasOutputDir, slug, "docs", "idea.json");
      if (!existsSync(ideaJsonPath)) continue;

      let ideaFromDisk;
      try {
        ideaFromDisk = JSON.parse(readFileSync(ideaJsonPath, "utf-8"));
      } catch (err) {
        console.error(`[plugins] Skipping invalid idea JSON (${ideaJsonPath}):`, err.message);
        continue;
      }

      const existingIdea = existingBySlug.get(slug);
      const createdAt =
        existingIdea?.createdAt ||
        statSync(ideaJsonPath).mtime.toISOString();

      rebuilt.push(
        normalizeIdea({
          ...ideaFromDisk,
          slug,
          createdAt,
          path: join(businessIdeasOutputDir, slug),
        })
      );
    }

    rebuilt.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const existingNormalized = existing.map(normalizeIdea);
    if (JSON.stringify(existingNormalized) !== JSON.stringify(rebuilt)) {
      writeFileSync(businessIdeasFile, JSON.stringify(rebuilt, null, 2));
      console.log(`[plugins] Reconciled business ideas index (${rebuilt.length} ideas)`);
    }
  } catch (err) {
    console.error("[plugins] Business ideas reconcile failed:", err.message);
  }
}

/**
 * Register an active notification (reminder, scheduled task, etc.) for cross-plugin visibility.
 * @param {string} id - Unique ID for this notification
 * @param {Object} info - { pluginName, label, type, nextAt?, meta? }
 */
function registerNotification(id, info) {
  notificationRegistry.set(id, info);
}

/**
 * Remove a notification from the registry.
 * @param {string} id - The notification ID to remove
 */
function unregisterNotification(id) {
  notificationRegistry.delete(id);
}

/**
 * Get all registered notifications from all plugins.
 */
function getRegisteredNotifications() {
  return [...notificationRegistry.values()];
}

/**
 * Discover plugin files from configured plugin directories.
 * Returns array of absolute file paths.
 */
function discoverPluginFiles() {
  const files = [];
  const pluginDirs = getPluginDirs(_config);
  console.log(`[plugins] Scanning directories: ${pluginDirs.join(", ") || "(none)"}`);

  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === "ENOENT") {
        console.warn(`[plugins] Directory not found: ${dir}`);
      } else {
        console.error(`[plugins] Error reading ${dir}:`, err.message);
      }
      return;
    }

    for (const entry of entries) {
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
        continue;
      }

      if (entry.isSymbolicLink()) {
        try {
          const target = statSync(entryPath);
          if (target.isDirectory()) {
            walk(entryPath);
            continue;
          }
          if (target.isFile() && /\.(?:cjs|mjs|js)$/i.test(entry.name)) {
            files.push(entryPath);
          }
        } catch (err) {
          console.warn(`[plugins] Failed to follow symlink: ${entryPath} (${err.message})`);
        }
        continue;
      }

      if (/\.(?:cjs|mjs|js)$/i.test(entry.name)) {
        files.push(entryPath);
      }
    }
  };

  for (const dir of pluginDirs) {
    walk(dir);
  }

  return files;
}

/**
 * Load all plugins from the plugins directory
 * @param {Object} options
 * @param {Map<string, BaseChannel>} options.channels - Channel instances
 * @param {Object} options.config - App configuration
 * @param {function} options.runClaude - Claude runner function
 */
export async function loadPlugins({ channels, config, runClaude }) {
  _runClaude = runClaude;
  _config = config;
  _channels = channels;
  loadedPluginNames.clear();

  const pluginFiles = discoverPluginFiles();

  if (pluginFiles.length === 0) {
    console.log("[plugins] No plugin files found, skipping plugin loading");
    return [];
  }

  const loadedPlugins = [];

  for (const filePath of pluginFiles) {
    try {
      const pluginPath = pathToFileURL(filePath).href;
      const plugin = (await import(pluginPath)).default;

      if (!plugin || !plugin.name) {
        console.warn(`[plugins] Skipping ${filePath}: no default export or missing 'name'`);
        continue;
      }

      console.log(`[plugins] Loading: ${plugin.name}`);

      // Register commands (will be triggered by .commandName)
      if (plugin.commands) {
        const helpMap = plugin.help || {};
        for (const [cmdName, handler] of Object.entries(plugin.commands)) {
          commandHandlers.set(cmdName.toLowerCase(), {
            handler,
            pluginName: plugin.name,
            description: helpMap[cmdName] || null,
            pluginFilePath: filePath,
          });
          console.log(`[plugins]   Registered command: .${cmdName}`);
        }
      }

      // Set up scheduled tasks
      if (plugin.schedules) {
        for (const schedule of plugin.schedules) {
          if (!cron.validate(schedule.cron)) {
            console.error(`[plugins] Invalid cron expression: ${schedule.cron}`);
            continue;
          }

          const cronOptions = schedule.timezone ? { timezone: schedule.timezone } : {};
          const task = cron.schedule(schedule.cron, async () => {
            const targetUserId = _config?.plugins?.targetChatId;
            if (targetUserId && !isPluginEnabled(plugin.name, String(targetUserId), _config)) {
              console.log(`[plugins] Skipping scheduled task for disabled plugin: ${plugin.name}`);
              return;
            }
            console.log(`[plugins] Running scheduled task for: ${plugin.name}`);
            try {
              await schedule.handler({
                channels: _channels,
                config: _config,
                claude: _runClaude
              });
            } catch (err) {
              console.error(`[plugins] Scheduled task error (${plugin.name}):`, err.message);
            }
          }, cronOptions);
          scheduledTasks.push(task);
          scheduleRegistry.push({
            pluginName: plugin.name,
            cron: schedule.cron,
            timezone: schedule.timezone || null,
            label: schedule.label || null,
          });
          console.log(`[plugins]   Scheduled task: ${schedule.cron}${schedule.timezone ? ` (${schedule.timezone})` : ""}`);
        }
      }

      // Register message handler
      if (plugin.onMessage) {
        messageHandlers.push({
          name: plugin.name,
          handler: plugin.onMessage,
        });
        console.log(`[plugins]   Registered message handler`);
      }

      // Register destroy handler for cleanup on reload
      if (plugin.destroy) {
        destroyHandlers.push({
          name: plugin.name,
          handler: plugin.destroy,
        });
        console.log(`[plugins]   Registered destroy handler`);
      }

      // Call init if provided (runs once at startup)
      if (plugin.init) {
        try {
          await plugin.init({
            channels: _channels,
            config: _config,
            claude: _runClaude,
            registerNotification,
            unregisterNotification,
          });
          console.log(`[plugins]   Initialized`);
        } catch (err) {
          console.error(`[plugins]   Init error:`, err.message);
        }
      }

      loadedPluginNames.add(plugin.name);
      loadedPlugins.push(plugin.name);
    } catch (err) {
      console.error(`[plugins] Failed to load ${filePath}:`, err.message);
    }
  }

  reconcileBusinessIdeas({ force: true });
  reconcileEvolveSuggestions();
  if (businessIdeasReconcileInterval) {
    clearInterval(businessIdeasReconcileInterval);
    businessIdeasReconcileInterval = null;
  }
  businessIdeasReconcileInterval = setInterval(() => {
    reconcileBusinessIdeas();
  }, 60_000);

  console.log(`[plugins] Loaded ${loadedPlugins.length} plugin(s): ${loadedPlugins.join(", ") || "none"}`);
  return loadedPlugins;
}

/**
 * Create a reply helper for a message
 * @param {Message} msg - The message to reply to
 * @returns {function(string): Promise<void>}
 */
function createReplyHelper(msg) {
  return async (text) => {
    const channel = _channels.get(msg.channelType);
    if (!channel) {
      console.error(`[plugins] No channel for type: ${msg.channelType}`);
      return;
    }
    await channel.send(msg.channelId, text);
  };
}

/**
 * Create a sendTyping helper for a message
 * @param {Message} msg
 * @returns {function(): Promise<void>}
 */
function createTypingHelper(msg) {
  return async () => {
    const channel = _channels.get(msg.channelType);
    if (channel) {
      await channel.sendTyping(msg.channelId);
    }
  };
}

/**
 * Try to handle a message with plugin handlers
 * @param {Message} msg - Unified message object
 * @returns {Promise<boolean>} true if a plugin handled the message
 */
export async function handlePluginMessage(msg) {
  const text = msg.text || "";
  const channel = _channels.get(msg.channelType);
  
  const helpers = {
    reply: createReplyHelper(msg),
    sendTyping: createTypingHelper(msg),
    claude: _runClaude,
    config: _config,
    channel,
    channels: _channels,
    getRegisteredCommands,
    getRegisteredSchedules,
    getLoadedPluginNames,
    registerNotification,
    unregisterNotification,
    getRegisteredNotifications,
  };
  
  // Handle .commands
  if (text.startsWith(".")) {
    const parts = text.slice(1).split(/\s+/);
    const cmdName = parts[0].toLowerCase();

    const cmd = commandHandlers.get(cmdName);
    if (cmd) {
      // Always allow the plugins manager itself so users can re-enable plugins
      const pluginGated = cmd.pluginName !== "plugins" && !isPluginEnabled(cmd.pluginName, msg.userId, _config);
      if (pluginGated) {
        await helpers.reply(`Plugin **${cmd.pluginName}** is disabled. Use \`.plugins enable ${cmd.pluginName}\` to re-enable.`);
        return true;
      }
      try {
        await cmd.handler(msg, helpers);
        if (cmdName === "idea" || cmdName === "cook" || cmdName === "idealist") {
          reconcileBusinessIdeas({ force: true });
        }
        if (cmdName === "evolve") {
          reconcileEvolveSuggestions(cmd.pluginFilePath);
        }
        return true;
      } catch (err) {
        console.error(`[plugins] Error in .${cmdName}:`, err.message);
        await helpers.reply(`Error: ${err.message.slice(0, 200)}`);
        return true;
      }
    }
    // Unknown command - return false to let it fall through
    return false;
  }
  
  // Try other message handlers (for follow-up input like food diary prompts)
  for (const { name, handler } of messageHandlers) {
    try {
      const handled = await handler(msg, helpers);
      if (handled) return true;
    } catch (err) {
      console.error(`[plugins] Message handler error (${name}):`, err.message);
    }
  }
  return false;
}

/**
 * Hot reload all plugins without restarting the process
 * @returns {Promise<{success: boolean, loaded: string[], errors: string[]}>}
 */
export async function reloadPlugins() {
  console.log("[plugins] Hot reloading plugins...");
  
  const errors = [];
  
  // Call destroy handlers for plugin cleanup (timers, connections, etc.)
  for (const { name, handler } of destroyHandlers) {
    try {
      await handler();
      console.log(`[plugins] Destroyed: ${name}`);
    } catch (err) {
      console.error(`[plugins] Destroy error (${name}):`, err.message);
    }
  }
  destroyHandlers.length = 0;

  // Stop all scheduled tasks
  for (const task of scheduledTasks) {
    try {
      task.stop();
    } catch (err) {
      // Ignore stop errors
    }
  }
  scheduledTasks.length = 0;
  scheduleRegistry.length = 0;
  notificationRegistry.clear();
  if (businessIdeasReconcileInterval) {
    clearInterval(businessIdeasReconcileInterval);
    businessIdeasReconcileInterval = null;
  }

  // Clear existing handlers
  commandHandlers.clear();
  messageHandlers.length = 0;
  loadedPluginNames.clear();
  
  // Re-load all plugins with cache-busting
  const pluginFiles = discoverPluginFiles();
  const loadedPlugins = [];

  for (const filePath of pluginFiles) {
    try {
      const pluginPath = pathToFileURL(filePath).href;
      // Add cache-busting query param to force re-import
      const freshPath = `${pluginPath}?reload=${Date.now()}`;
      const plugin = (await import(freshPath)).default;

      if (!plugin || !plugin.name) {
        console.warn(`[plugins] Skipping ${filePath}: no default export or missing 'name'`);
        continue;
      }

      console.log(`[plugins] Reloading: ${plugin.name}`);

      // Register commands
      if (plugin.commands) {
        const helpMap = plugin.help || {};
        for (const [cmdName, handler] of Object.entries(plugin.commands)) {
          commandHandlers.set(cmdName.toLowerCase(), {
            handler,
            pluginName: plugin.name,
            description: helpMap[cmdName] || null,
            pluginFilePath: filePath,
          });
          console.log(`[plugins]   Registered command: .${cmdName}`);
        }
      }

      // Set up scheduled tasks
      if (plugin.schedules) {
        for (const schedule of plugin.schedules) {
          if (!cron.validate(schedule.cron)) {
            console.error(`[plugins] Invalid cron expression: ${schedule.cron}`);
            continue;
          }

          const cronOptions = schedule.timezone ? { timezone: schedule.timezone } : {};
          const task = cron.schedule(schedule.cron, async () => {
            const targetUserId = _config?.plugins?.targetChatId;
            if (targetUserId && !isPluginEnabled(plugin.name, String(targetUserId), _config)) {
              console.log(`[plugins] Skipping scheduled task for disabled plugin: ${plugin.name}`);
              return;
            }
            console.log(`[plugins] Running scheduled task for: ${plugin.name}`);
            try {
              await schedule.handler({
                channels: _channels,
                config: _config,
                claude: _runClaude
              });
            } catch (err) {
              console.error(`[plugins] Scheduled task error (${plugin.name}):`, err.message);
            }
          }, cronOptions);
          scheduledTasks.push(task);
          scheduleRegistry.push({
            pluginName: plugin.name,
            cron: schedule.cron,
            timezone: schedule.timezone || null,
            label: schedule.label || null,
          });
          console.log(`[plugins]   Scheduled task: ${schedule.cron}${schedule.timezone ? ` (${schedule.timezone})` : ""}`);
        }
      }

      // Register message handler
      if (plugin.onMessage) {
        messageHandlers.push({
          name: plugin.name,
          handler: plugin.onMessage,
        });
        console.log(`[plugins]   Registered message handler`);
      }

      // Register destroy handler for cleanup on reload
      if (plugin.destroy) {
        destroyHandlers.push({
          name: plugin.name,
          handler: plugin.destroy,
        });
        console.log(`[plugins]   Registered destroy handler`);
      }

      // Call init if provided
      if (plugin.init) {
        try {
          await plugin.init({
            channels: _channels,
            config: _config,
            claude: _runClaude,
            registerNotification,
            unregisterNotification,
          });
          console.log(`[plugins]   Initialized`);
        } catch (err) {
          console.error(`[plugins]   Init error:`, err.message);
          errors.push(`${plugin.name} init: ${err.message}`);
        }
      }

      loadedPlugins.push(plugin.name);
    } catch (err) {
      console.error(`[plugins] Failed to reload ${filePath}:`, err.message);
      errors.push(`${filePath}: ${err.message}`);
    }
  }

  console.log(`[plugins] Reloaded ${loadedPlugins.length} plugin(s): ${loadedPlugins.join(", ") || "none"}`);
  reconcileBusinessIdeas({ force: true });
  reconcileEvolveSuggestions();
  businessIdeasReconcileInterval = setInterval(() => {
    reconcileBusinessIdeas();
  }, 60_000);
  return { 
    success: errors.length === 0, 
    loaded: loadedPlugins, 
    errors 
  };
}

/**
 * Get all registered commands with their plugin names and descriptions
 * @returns {Array<{ command: string, pluginName: string, description: string|null }>}
 */
export function getRegisteredCommands() {
  const commands = [];
  for (const [command, { pluginName, description }] of commandHandlers) {
    commands.push({ command, pluginName, description });
  }
  return commands;
}

/**
 * Get registered commands filtered to those enabled for a specific user.
 * The "plugins" plugin is always included.
 */
function getRegisteredCommandsForUser(userId) {
  const commands = [];
  for (const [command, { pluginName, description }] of commandHandlers) {
    if (pluginName === "plugins" || isPluginEnabled(pluginName, userId, _config)) {
      commands.push({ command, pluginName, description });
    }
  }
  return commands;
}

/**
 * Get the names of all currently loaded plugins.
 */
export function getLoadedPluginNames() {
  return [...loadedPluginNames];
}

/**
 * Get all registered schedules with their plugin names and cron expressions
 */
export function getRegisteredSchedules() {
  return [...scheduleRegistry];
}

/**
 * Run all plugin destroy handlers and stop scheduled tasks.
 * Called during graceful shutdown to clean up timers, connections, etc.
 */
export async function destroyPlugins() {
  if (businessIdeasReconcileInterval) {
    clearInterval(businessIdeasReconcileInterval);
    businessIdeasReconcileInterval = null;
  }
  for (const { name, handler } of destroyHandlers) {
    try {
      await handler();
      console.log(`[plugins] Destroyed: ${name}`);
    } catch (err) {
      console.error(`[plugins] Destroy error (${name}):`, err.message);
    }
  }
  for (const task of scheduledTasks) {
    try {
      task.stop();
    } catch (err) {
      // Ignore stop errors
    }
  }
}

export default { loadPlugins, handlePluginMessage, reloadPlugins, getRegisteredCommands, getRegisteredSchedules, getRegisteredNotifications, destroyPlugins };
