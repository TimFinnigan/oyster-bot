/**
 * Quotes Plugin
 * 
 * Sends positive, uplifting quotes using Claude.
 * - .quote command: get a quote on demand
 * - Scheduled: sends a quote at the configured interval (default: hourly)
 */

const QUOTE_PROMPT = `Generate a single short, uplifting, and motivational quote. 
Be creative and original - don't use famous quotes. 
Keep it under 280 characters. 
Just output the quote itself, nothing else - no quotation marks, no attribution, no preamble.`;

export default {
  name: "quotes",

  commands: {
    quote: async (msg, { sendTyping, reply, claude }) => {
      await sendTyping();
      
      const result = await claude(QUOTE_PROMPT);
      const quote = result.result || result.content || "Stay positive!";
      
      await reply(`✨ ${quote}`);
    },
  },

  schedules: [
    {
      // Default: every hour on the hour. Override with QUOTES_CRON env var.
      cron: process.env.QUOTES_CRON || "0 * * * *",
      
      handler: async ({ channels, config, claude }) => {
        const targetChatId = config.plugins?.targetChatId;
        const targetChannel = config.plugins?.targetChannel || "telegram";
        
        if (!targetChatId) {
          console.log("[quotes] No PLUGIN_TARGET_CHAT_ID configured, skipping scheduled quote");
          return;
        }

        const channel = channels.get(targetChannel);
        if (!channel) {
          console.log(`[quotes] Channel '${targetChannel}' not available, skipping scheduled quote`);
          return;
        }

        try {
          const result = await claude(QUOTE_PROMPT);
          const quote = result.result || result.content || "Stay positive!";
          
          await channel.send(String(targetChatId), `✨ ${quote}`);
          console.log("[quotes] Sent scheduled quote");
        } catch (err) {
          console.error("[quotes] Failed to send scheduled quote:", err.message);
        }
      },
    },
  ],
};
