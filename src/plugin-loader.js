import { readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import cron from "node-cron";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

// Collected command handlers from plugins: commandName -> { handler, pluginName }
const commandHandlers = new Map();
// Collected message handlers from plugins
const messageHandlers = [];

// Store references for use in handlers
let _runClaude, _config, _channels;

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
  
  const pluginsDir = join(__dirname, "..", "plugins");
  
  let files;
  try {
    files = readdirSync(pluginsDir).filter((f) => f.endsWith(".js"));
  } catch (err) {
    if (err.code === "ENOENT") {
      console.log("[plugins] No plugins directory found, skipping plugin loading");
      return [];
    }
    throw err;
  }

  const loadedPlugins = [];

  for (const file of files) {
    try {
      const pluginPath = pathToFileURL(join(pluginsDir, file)).href;
      const plugin = (await import(pluginPath)).default;

      if (!plugin || !plugin.name) {
        console.warn(`[plugins] Skipping ${file}: no default export or missing 'name'`);
        continue;
      }

      console.log(`[plugins] Loading: ${plugin.name}`);

      // Register commands (will be triggered by .commandName)
      if (plugin.commands) {
        for (const [cmdName, handler] of Object.entries(plugin.commands)) {
          commandHandlers.set(cmdName.toLowerCase(), {
            handler,
            pluginName: plugin.name,
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

          cron.schedule(schedule.cron, async () => {
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
          });
          console.log(`[plugins]   Scheduled task: ${schedule.cron}`);
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

      // Call init if provided (runs once at startup)
      if (plugin.init) {
        try {
          await plugin.init({
            channels: _channels,
            config: _config,
            claude: _runClaude,
          });
          console.log(`[plugins]   Initialized`);
        } catch (err) {
          console.error(`[plugins]   Init error:`, err.message);
        }
      }

      loadedPlugins.push(plugin.name);
    } catch (err) {
      console.error(`[plugins] Failed to load ${file}:`, err.message);
    }
  }

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
  };
  
  // Handle .commands
  if (text.startsWith(".")) {
    const parts = text.slice(1).split(/\s+/);
    const cmdName = parts[0].toLowerCase();
    
    const cmd = commandHandlers.get(cmdName);
    if (cmd) {
      try {
        await cmd.handler(msg, helpers);
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

export default { loadPlugins, handlePluginMessage };
