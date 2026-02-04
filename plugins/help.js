/**
 * Help Plugin
 *
 * Shows all available plugin commands.
 * - .help — List all commands grouped by plugin
 */

export default {
  name: "help",

  help: {
    help: "Show all available commands",
  },

  commands: {
    help: async (msg, { reply, getRegisteredCommands }) => {
      const commands = getRegisteredCommands();

      // Group by plugin name
      const grouped = {};
      for (const { command, pluginName, description } of commands) {
        if (!grouped[pluginName]) grouped[pluginName] = [];
        grouped[pluginName].push({ command, description });
      }

      const lines = [];
      for (const [plugin, cmds] of Object.entries(grouped)) {
        lines.push(`${plugin}`);
        for (const { command, description } of cmds) {
          lines.push(description ? `  .${command} — ${description}` : `  .${command}`);
        }
        lines.push("");
      }

      await reply(lines.join("\n").trimEnd());
    },
  },
};
