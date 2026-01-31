/**
 * Base Channel Interface
 * 
 * Abstract class that defines the interface all channel adapters must implement.
 * Each messaging platform (Telegram, Discord, Slack, etc.) extends this class.
 */

export class BaseChannel {
  /**
   * @param {Object} config - Channel-specific configuration
   */
  constructor(config) {
    this.config = config;
    this.type = 'base'; // Override in subclass
    
    /**
     * Message callback - set by the app to receive incoming messages
     * @type {function(Message): void}
     */
    this.onMessage = null;
  }

  /**
   * Start the channel (connect, authenticate, start polling/webhooks)
   * @returns {Promise<void>}
   */
  async start() {
    throw new Error('start() must be implemented by subclass');
  }

  /**
   * Stop the channel gracefully
   * @returns {Promise<void>}
   */
  async stop() {
    throw new Error('stop() must be implemented by subclass');
  }

  /**
   * Send a text message to a channel
   * @param {string} channelId - Target channel/chat ID
   * @param {string} text - Message text
   * @returns {Promise<void>}
   */
  async send(channelId, text) {
    throw new Error('send() must be implemented by subclass');
  }

  /**
   * Send typing indicator
   * @param {string} channelId - Target channel/chat ID
   * @returns {Promise<void>}
   */
  async sendTyping(channelId) {
    throw new Error('sendTyping() must be implemented by subclass');
  }

  /**
   * Check if a user is allowed to use the bot
   * @param {string} userId - User ID to check
   * @returns {boolean}
   */
  isAllowed(userId) {
    if (!this.config.allowedUserIds) return true;
    return this.config.allowedUserIds.includes(userId);
  }

  // Optional methods - override if the platform supports them

  /**
   * React to a message with an emoji
   * @param {string} channelId
   * @param {string} messageId
   * @param {string} emoji
   * @returns {Promise<void>}
   */
  async react(channelId, messageId, emoji) {
    // Optional - not all platforms support reactions
  }

  /**
   * Edit an existing message
   * @param {string} channelId
   * @param {string} messageId
   * @param {string} newText
   * @returns {Promise<void>}
   */
  async edit(channelId, messageId, newText) {
    // Optional - not all platforms support editing
  }

  /**
   * Reply to a specific message
   * @param {string} channelId
   * @param {string} messageId
   * @param {string} text
   * @returns {Promise<void>}
   */
  async reply(channelId, messageId, text) {
    // Default: just send a regular message
    await this.send(channelId, text);
  }
}

export default BaseChannel;
