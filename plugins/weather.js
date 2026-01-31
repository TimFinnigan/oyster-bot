/**
 * Weather Plugin
 * 
 * Get current weather using web search.
 * - .weather command: get weather for your location (prompts to share) or a specified place
 * - .weather <location>: get weather for a specific location
 * - Share location after prompt to get weather for your current position
 * - Scheduled: sends daily weather at configured time (default: 8am)
 */

// Track users waiting to share location (keyed by channelType:userId)
const waitingForLocation = new Set();

/**
 * Get a unique key for tracking user state across channels
 */
function getUserKey(msg) {
  return `${msg.channelType}:${msg.userId}`;
}

/**
 * Build the weather prompt for Claude
 */
function buildWeatherPrompt(location) {
  return `Search the web for current weather in ${location} and give me a brief, straightforward weather report.

Format your response exactly like this (no extra text):
🌡️ Temperature: [current temp]
☁️ Conditions: [conditions]
💧 Humidity: [humidity]%
💨 Wind: [wind speed and direction]
📅 Today: [high]/[low]

Keep it simple and factual. No greetings or extra commentary.`;
}

/**
 * Fetch and send weather for a location
 */
async function fetchWeather(location, { sendTyping, reply, claude }) {
  await sendTyping();
  
  try {
    const result = await claude(buildWeatherPrompt(location));
    const weather = result.result || "Unable to fetch weather data.";
    await reply(weather);
  } catch (err) {
    console.error("[weather] Error fetching weather:", err.message);
    await reply("❌ Couldn't get weather data. Try again later.");
  }
}

export default {
  name: "weather",

  commands: {
    weather: async (msg, helpers) => {
      const { reply, channel, config } = helpers;
      const userKey = getUserKey(msg);
      const text = msg.text.replace(/^\.weather\s*/i, "").trim();
      
      // Get default location from config
      const defaultLocation = config.plugins?.weatherDefaultLocation;
      
      if (text) {
        // Location specified: .weather Seattle
        await fetchWeather(text, helpers);
      } else if (defaultLocation) {
        // Use default location from config
        await fetchWeather(defaultLocation, helpers);
      } else {
        // No location and no default - ask for location sharing
        waitingForLocation.add(userKey);
        
        // Send message with location request keyboard (Telegram-specific)
        if (msg.channelType === "telegram" && channel?.bot) {
          await channel.bot.telegram.sendMessage(
            msg.channelId,
            "📍 Share your location to get local weather, or type a location (e.g., `.weather Seattle`):",
            {
              reply_markup: {
                keyboard: [[{ text: "📍 Share Location", request_location: true }]],
                one_time_keyboard: true,
                resize_keyboard: true,
              },
            }
          );
        } else {
          await reply("Please specify a location: `.weather Seattle` or `.weather 98021`");
        }
      }
    },
  },

  // Handle location messages
  onMessage: async (msg, helpers) => {
    const userKey = getUserKey(msg);
    
    // Check if this is a location message from someone who requested weather
    if (msg.location && waitingForLocation.has(userKey)) {
      waitingForLocation.delete(userKey);
      
      const { latitude, longitude } = msg.location;
      const locationStr = `coordinates ${latitude}, ${longitude}`;
      
      // Remove the keyboard after receiving location
      if (msg.channelType === "telegram" && helpers.channel?.bot) {
        await helpers.channel.bot.telegram.sendMessage(
          msg.channelId,
          "📍 Got your location! Fetching weather...",
          { reply_markup: { remove_keyboard: true } }
        );
      }
      
      await fetchWeather(locationStr, helpers);
      return true; // Handled
    }
    
    return false; // Not handled
  },

  schedules: [
    {
      // Default: 8am daily. Override with WEATHER_CRON env var.
      cron: process.env.WEATHER_CRON || "0 8 * * *",
      
      handler: async ({ channels, config, claude }) => {
        const targetChatId = config.plugins?.targetChatId;
        const targetChannel = config.plugins?.targetChannel || "telegram";
        const location = config.plugins?.weatherDefaultLocation;
        
        if (!targetChatId) {
          console.log("[weather] No PLUGIN_TARGET_CHAT_ID configured, skipping scheduled weather");
          return;
        }
        
        if (!location) {
          console.log("[weather] No WEATHER_DEFAULT_LOCATION configured, skipping scheduled weather");
          return;
        }

        const channel = channels.get(targetChannel);
        if (!channel) {
          console.log(`[weather] Channel '${targetChannel}' not available, skipping scheduled weather`);
          return;
        }

        try {
          const result = await claude(buildWeatherPrompt(location));
          const weather = result.result || "Unable to fetch weather data.";
          
          await channel.send(String(targetChatId), `☀️ Good morning! Here's today's weather:\n\n${weather}`);
          console.log("[weather] Sent scheduled weather report");
        } catch (err) {
          console.error("[weather] Failed to send scheduled weather:", err.message);
        }
      },
    },
  ],
};
