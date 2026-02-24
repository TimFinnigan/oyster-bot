/**
 * Plugins Management Plugin
 *
 * Enable or disable individual plugins per-user.
 * Disabling a plugin suppresses its scheduled alerts; commands still work.
 *
 * Commands:
 * - .plugins              — list all loaded plugins with enabled/disabled status
 * - .plugins enable <name>  — enable a plugin
 * - .plugins disable <name> — disable a plugin
 */

import { isPluginEnabled, setPluginEnabled } from "../src/plugin-settings.js";

export default {
  name: "plugins",

  help: {
    plugins: "Manage plugins. Usage: .plugins | .plugins enable <name> | .plugins disable <name>",
  },

  commands: {
    plugins: async (msg, { reply, config, getLoadedPluginNames }) => {
      const input = msg.text.replace(/^\.plugins\s*/i, "").trim();
      const [sub, ...rest] = input.split(/\s+/);
      const lowerSub = sub?.toLowerCase();

      // .plugins enable <name>
      if (lowerSub === "enable" || lowerSub === "disable") {
        const targetName = rest.join(" ").trim().toLowerCase();
        if (!targetName) {
          await reply(`Usage: \`.plugins ${lowerSub} <plugin-name>\``);
          return;
        }

        const allPlugins = getLoadedPluginNames();
        const match = allPlugins.find((n) => n.toLowerCase() === targetName);
        if (!match) {
          await reply(`Plugin "${targetName}" not found. Use \`.plugins\` to list available plugins.`);
          return;
        }

        if (match === "plugins") {
          await reply("The plugins manager cannot be disabled.");
          return;
        }

        const enabled = lowerSub === "enable";
        setPluginEnabled(match, msg.userId, enabled, config);
        await reply(`${enabled ? "✅ Enabled" : "⛔ Disabled"}: **${match}**`);
        return;
      }

      // .plugins list (or bare .plugins)
      const allPlugins = getLoadedPluginNames();
      const lines = allPlugins.sort().map((name) => {
        const on = isPluginEnabled(name, msg.userId, config);
        return `${on ? "✅" : "⛔"} ${name}`;
      });

      await reply(`Loaded plugins:\n\n${lines.join("\n")}\n\nUse \`.plugins enable <name>\` or \`.plugins disable <name>\` to toggle.`);
    },
  },
};
