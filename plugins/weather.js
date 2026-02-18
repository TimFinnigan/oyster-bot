/**
 * Weather Plugin
 *
 * Get current weather using Open-Meteo API (no API key required).
 * - .weather command: get weather for your location (prompts to share) or a specified place
 * - .weather <location>: get weather for a specific location
 * - Share location after prompt to get weather for your current position
 * - Scheduled: sends daily weather at configured time (default: 8am)
 */

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

// WMO Weather interpretation codes → description + emoji
const WMO_CODES = {
  0: { description: "Clear sky", emoji: "☀️" },
  1: { description: "Mainly clear", emoji: "🌤️" },
  2: { description: "Partly cloudy", emoji: "⛅" },
  3: { description: "Overcast", emoji: "☁️" },
  45: { description: "Foggy", emoji: "🌫️" },
  48: { description: "Depositing rime fog", emoji: "🌫️" },
  51: { description: "Light drizzle", emoji: "🌦️" },
  53: { description: "Moderate drizzle", emoji: "🌦️" },
  55: { description: "Dense drizzle", emoji: "🌧️" },
  56: { description: "Light freezing drizzle", emoji: "🌧️" },
  57: { description: "Dense freezing drizzle", emoji: "🌧️" },
  61: { description: "Slight rain", emoji: "🌧️" },
  63: { description: "Moderate rain", emoji: "🌧️" },
  65: { description: "Heavy rain", emoji: "🌧️" },
  66: { description: "Light freezing rain", emoji: "🌧️" },
  67: { description: "Heavy freezing rain", emoji: "🌧️" },
  71: { description: "Slight snowfall", emoji: "🌨️" },
  73: { description: "Moderate snowfall", emoji: "🌨️" },
  75: { description: "Heavy snowfall", emoji: "❄️" },
  77: { description: "Snow grains", emoji: "🌨️" },
  80: { description: "Slight rain showers", emoji: "🌦️" },
  81: { description: "Moderate rain showers", emoji: "🌧️" },
  82: { description: "Violent rain showers", emoji: "🌧️" },
  85: { description: "Slight snow showers", emoji: "🌨️" },
  86: { description: "Heavy snow showers", emoji: "❄️" },
  95: { description: "Thunderstorm", emoji: "⛈️" },
  96: { description: "Thunderstorm with slight hail", emoji: "⛈️" },
  99: { description: "Thunderstorm with heavy hail", emoji: "⛈️" },
};

// Track users waiting to share location (keyed by channelType:userId)
const waitingForLocation = new Set();

/**
 * Get a unique key for tracking user state across channels
 */
function getUserKey(msg) {
  return `${msg.channelType}:${msg.userId}`;
}

function getUnits() {
  return (process.env.WEATHER_UNITS || "fahrenheit").toLowerCase();
}

/**
 * Convert wind direction degrees to compass abbreviation
 */
function degreesToDirection(degrees) {
  const directions = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
  ];
  const index = Math.round(degrees / 22.5) % 16;
  return directions[index];
}

/**
 * Geocode a location name to coordinates using Open-Meteo
 */
async function geocodeLocation(query) {
  // Try the full query first, then fall back to just the city name.
  // Open-Meteo geocoding doesn't handle "City, ST" format well.
  const attempts = [query];
  const cityOnly = query.split(",")[0].trim();
  if (cityOnly !== query.trim()) {
    attempts.push(cityOnly);
  }

  let data;
  for (const attempt of attempts) {
    const url = `${GEOCODING_URL}?name=${encodeURIComponent(attempt)}&count=1&language=en`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Geocoding failed: ${response.status}`);
    }

    data = await response.json();
    if (data.results && data.results.length > 0) break;
  }

  if (!data.results || data.results.length === 0) {
    return null;
  }

  const result = data.results[0];
  return {
    latitude: result.latitude,
    longitude: result.longitude,
    name: result.name,
    admin1: result.admin1 || null,
    country: result.country || null,
    timezone: result.timezone || "auto",
  };
}

/**
 * Fetch weather data from Open-Meteo forecast API
 */
async function fetchWeatherData(latitude, longitude, timezone = "auto") {
  const units = getUnits();
  const windUnit = units === "fahrenheit" ? "mph" : "kmh";

  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m,wind_speed_10m,wind_direction_10m,weather_code",
    daily: "temperature_2m_max,temperature_2m_min",
    temperature_unit: units,
    wind_speed_unit: windUnit,
    timezone,
    forecast_days: "1",
  });

  const response = await fetch(`${FORECAST_URL}?${params}`);

  if (!response.ok) {
    throw new Error(`Weather API failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Format weather API response into the display format
 */
function formatWeatherResponse(data, locationName) {
  const { current, daily } = data;
  const units = getUnits();
  const tempSymbol = units === "fahrenheit" ? "F" : "C";
  const windUnitLabel = units === "fahrenheit" ? "mph" : "km/h";

  const weatherInfo = WMO_CODES[current.weather_code] || { description: "Unknown", emoji: "🌡️" };
  const windDir = degreesToDirection(current.wind_direction_10m);

  const temp = Math.round(current.temperature_2m);
  const high = Math.round(daily.temperature_2m_max[0]);
  const low = Math.round(daily.temperature_2m_min[0]);
  const windSpeed = Math.round(current.wind_speed_10m);

  return [
    `${weatherInfo.emoji} Weather for ${locationName}`,
    ``,
    `🌡️ Temperature: ${temp}°${tempSymbol}`,
    `☁️ Conditions: ${weatherInfo.description}`,
    `💨 Wind: ${windSpeed} ${windUnitLabel} ${windDir}`,
    `📅 Today: ${high}°${tempSymbol} / ${low}°${tempSymbol}`,
  ].join("\n");
}

/**
 * Build a display name from geocoding result
 */
function buildLocationName(geo) {
  return [geo.name, geo.admin1, geo.country].filter(Boolean).join(", ");
}

/**
 * Fetch and send weather for a location
 */
async function fetchWeather(location, { sendTyping, reply }) {
  await sendTyping();

  try {
    let latitude, longitude, locationName, timezone;

    // Check if location is coordinates (from Telegram location sharing)
    const coordMatch = location.match(/^coordinates\s+([-\d.]+),\s*([-\d.]+)$/);

    if (coordMatch) {
      latitude = parseFloat(coordMatch[1]);
      longitude = parseFloat(coordMatch[2]);
      timezone = "auto";
      locationName = `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`;
    } else {
      const geo = await geocodeLocation(location);

      if (!geo) {
        await reply(`❌ Couldn't find location: "${location}". Try a different name or share your location.`);
        return;
      }

      latitude = geo.latitude;
      longitude = geo.longitude;
      timezone = geo.timezone;
      locationName = buildLocationName(geo);
    }

    const data = await fetchWeatherData(latitude, longitude, timezone);
    const weather = formatWeatherResponse(data, locationName);
    await reply(weather);
  } catch (err) {
    console.error("[weather] Error fetching weather:", err.message);
    await reply("❌ Couldn't get weather data. Try again later.");
  }
}

export default {
  name: "weather",

  help: {
    weather: "Get current weather for a location",
  },

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

      handler: async ({ channels, config }) => {
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
          const geo = await geocodeLocation(location);
          if (!geo) {
            console.error(`[weather] Could not geocode default location: ${location}`);
            return;
          }

          const data = await fetchWeatherData(geo.latitude, geo.longitude, geo.timezone);
          const locationName = buildLocationName(geo);
          const weather = formatWeatherResponse(data, locationName);

          await channel.send(String(targetChatId), `☀️ Good morning! Here's today's weather:\n\n${weather}`);
          console.log("[weather] Sent scheduled weather report");
        } catch (err) {
          console.error("[weather] Failed to send scheduled weather:", err.message);
        }
      },
    },
  ],
};
