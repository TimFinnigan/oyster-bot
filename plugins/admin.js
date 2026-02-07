/**
 * Admin Plugin
 *
 * Provides administrative commands for managing the bot:
 *   .reload  - Hot reload all plugins without restarting
 *   .stop    - Emergency stop (kills the process immediately)
 *   .restart - Full process restart (requires PM2)
 *   .status  - Show bot status and loaded plugins
 */

import { exec } from "child_process";
import { reloadPlugins, destroyPlugins } from "../src/plugin-loader.js";

export default {
  name: "admin",

  help: {
    reload: "Hot reload all plugins",
    stop: "Emergency stop the bot",
    restart: "Full process restart via PM2",
    status: "Show bot status and uptime",
  },

  commands: {
    async reload(msg, { reply }) {
      await reply("Reloading plugins...");

      try {
        const result = await reloadPlugins();

        if (result.success) {
          await reply(`Reloaded ${result.loaded.length} plugin(s): ${result.loaded.join(", ") || "none"}`);
        } else {
          await reply(
            `Reload completed with errors:\n` +
            `Loaded: ${result.loaded.join(", ") || "none"}\n` +
            `Errors: ${result.errors.join("; ")}`
          );
        }
      } catch (err) {
        await reply(`Reload failed: ${err.message}`);
      }
    },

    async stop(msg, { reply }) {
      await reply("Stopping bot...");
      await destroyPlugins();
      process.exit(0);
    },

    async restart(msg, { reply }) {
      await reply("Restarting bot via PM2...");

      exec("pm2 restart oyster-bot", (error, stdout, stderr) => {
        if (error) {
          console.error("[admin] PM2 restart failed:", error.message);
          console.error("[admin] stderr:", stderr);
        }
      });
    },

    async status(msg, { reply, config }) {
      const uptime = process.uptime();
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const seconds = Math.floor(uptime % 60);

      const memUsage = process.memoryUsage();
      const memMB = Math.round(memUsage.heapUsed / 1024 / 1024);

      await reply(
        `Bot Status:\n` +
        `• Uptime: ${hours}h ${minutes}m ${seconds}s\n` +
        `• Memory: ${memMB} MB\n` +
        `• Node: ${process.version}\n` +
        `• PID: ${process.pid}`
      );
    },
  },
};
