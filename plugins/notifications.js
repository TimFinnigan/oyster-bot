/**
 * Notifications Plugin
 *
 * Lists all active scheduled messages and their times across all plugins.
 * - .notifications — View all active notifications (reminders, recurring, cron schedules)
 */

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

function formatClockTime(hour, minute) {
  const period = hour >= 12 ? "pm" : "am";
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return minute === 0
    ? `${displayHour}${period}`
    : `${displayHour}:${String(minute).padStart(2, "0")}${period}`;
}

export default {
  name: "notifications",

  help: {
    notifications: "View all active scheduled notifications",
  },

  commands: {
    notifications: async (msg, { reply, getRegisteredSchedules, getRegisteredNotifications }) => {
      const sections = [];

      // Notifications from the registry (reminders, recurring, and any plugin-registered notifications)
      const notifications = typeof getRegisteredNotifications === "function" ? getRegisteredNotifications() : [];

      const reminders = notifications.filter(n => n.type === "reminder");
      if (reminders.length > 0) {
        const lines = reminders.map((r, i) => {
          const timeLeft = new Date(r.nextAt).getTime() - Date.now();
          const status = timeLeft > 0 ? `in ${formatDuration(timeLeft)}` : "sending soon";
          return `  ${i + 1}. "${r.label}" — ${status}`;
        });
        sections.push(`⏰ Reminders\n${lines.join("\n")}`);
      }

      const recurring = notifications.filter(n => n.type === "recurring");
      if (recurring.length > 0) {
        const lines = recurring.map((r, i) => {
          const timeLeft = new Date(r.nextAt).getTime() - Date.now();
          const timeStr = r.meta ? `daily at ${formatClockTime(r.meta.hour, r.meta.minute)}` : "";
          return `  ${i + 1}. "${r.label}" — ${timeStr} (next in ${formatDuration(timeLeft)})`;
        });
        sections.push(`🔁 Recurring\n${lines.join("\n")}`);
      }

      // Other plugin notifications (not reminder/recurring)
      const other = notifications.filter(n => n.type !== "reminder" && n.type !== "recurring");
      if (other.length > 0) {
        const lines = other.map((n, i) => {
          const timeInfo = n.nextAt ? ` — next in ${formatDuration(new Date(n.nextAt).getTime() - Date.now())}` : "";
          return `  ${i + 1}. [${n.pluginName}] ${n.label}${timeInfo}`;
        });
        sections.push(`🔔 Other\n${lines.join("\n")}`);
      }

      // Cron schedules (system-wide)
      const schedules = getRegisteredSchedules();
      if (schedules.length > 0) {
        const lines = schedules.map((s, i) => {
          const label = s.label || s.pluginName;
          return `  ${i + 1}. ${label} — ${s.cron}`;
        });
        sections.push(`🕐 Scheduled tasks\n${lines.join("\n")}`);
      }

      if (sections.length === 0) {
        await reply("No active notifications. You're all clear!");
        return;
      }

      await reply(`📋 Active notifications\n\n${sections.join("\n\n")}`);
    },
  },
};
