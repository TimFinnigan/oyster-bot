/**
 * Channel Registry
 * 
 * Central registry for all available channel adapters.
 * To add a new channel:
 * 1. Create a new file in src/channels/ extending BaseChannel
 * 2. Import and register it here
 */

import { TelegramChannel } from "./telegram.js";

/**
 * Available channel adapters
 * Add new channels here as they're implemented
 */
export const channelTypes = {
  telegram: TelegramChannel,
  // discord: DiscordChannel,
  // slack: SlackChannel,
  // signal: SignalChannel,
};

/**
 * Create a channel instance by type
 * @param {string} type - Channel type ('telegram', 'discord', etc.)
 * @param {Object} config - Channel configuration
 * @returns {BaseChannel}
 */
export function createChannel(type, config) {
  const ChannelClass = channelTypes[type];
  if (!ChannelClass) {
    throw new Error(`Unknown channel type: ${type}`);
  }
  return new ChannelClass(config);
}

/**
 * Create all enabled channels from config
 * @param {Object} channelsConfig - Config object with channel configs
 * @returns {Map<string, BaseChannel>}
 */
export function createChannels(channelsConfig) {
  const channels = new Map();

  for (const [type, channelConfig] of Object.entries(channelsConfig)) {
    if (!channelConfig.enabled) continue;

    if (!channelTypes[type]) {
      console.warn(`[channels] Unknown channel type: ${type}, skipping`);
      continue;
    }

    channels.set(type, createChannel(type, channelConfig));
  }

  return channels;
}

export { BaseChannel } from "./base.js";
export { TelegramChannel } from "./telegram.js";
