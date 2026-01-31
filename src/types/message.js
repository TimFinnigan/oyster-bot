/**
 * Unified Message Type
 * 
 * A channel-agnostic message object that all adapters convert to/from.
 * This abstraction allows the core bot logic and plugins to work
 * with any messaging platform.
 */

/**
 * Create a unified message object
 * @param {Object} params
 * @param {string} params.id - Unique message ID (from the channel)
 * @param {string} params.channelType - Channel identifier ('telegram', 'discord', 'slack', etc.)
 * @param {string} params.channelId - Channel-specific chat/room/conversation ID
 * @param {string} params.userId - Sender's user ID
 * @param {string} params.userName - Sender's display name
 * @param {string} params.text - Message text content
 * @param {Object} [params.location] - Location data { latitude, longitude }
 * @param {string} [params.replyToId] - ID of message being replied to (if any)
 * @param {Object} [params.raw] - Original channel-specific context (for advanced use)
 * @returns {Message}
 */
export function createMessage({
  id,
  channelType,
  channelId,
  userId,
  userName,
  text,
  location = null,
  replyToId = null,
  raw = null,
}) {
  return {
    id,
    channelType,
    channelId,
    userId,
    userName,
    text,
    location,
    replyToId,
    raw,
    timestamp: Date.now(),
  };
}

/**
 * Create a unique session key for a message
 * Combines channel type and channel ID to create a unique session identifier
 * @param {Message} msg
 * @returns {string}
 */
export function getSessionKey(msg) {
  return `${msg.channelType}:${msg.channelId}`;
}

/**
 * @typedef {Object} Message
 * @property {string} id
 * @property {string} channelType
 * @property {string} channelId
 * @property {string} userId
 * @property {string} userName
 * @property {string} text
 * @property {Object|null} location - { latitude: number, longitude: number }
 * @property {string|null} replyToId
 * @property {Object|null} raw
 * @property {number} timestamp
 */

export default { createMessage, getSessionKey };
