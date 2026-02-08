/**
 * Keepalive Plugin
 *
 * Prevents the bot from going idle by logging a heartbeat every 5 minutes.
 * Keeps the Node.js event loop active and the Telegram connection warm.
 */

export default {
  name: "keepalive",

  schedules: [
    {
      cron: "*/5 * * * *",
      label: "Heartbeat",
      handler: async () => {
        console.log("[keepalive] heartbeat");
      },
    },
  ],
};
