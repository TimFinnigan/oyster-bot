/**
 * Telegram Channel Adapter
 * 
 * Implements the BaseChannel interface for Telegram using Telegraf.
 */

import { Telegraf } from "telegraf";
import { BaseChannel } from "./base.js";
import { createMessage } from "../types/message.js";
import { toTelegramMarkdownV2, stripMarkdown } from "../utils/telegram-markdown.js";

export class TelegramChannel extends BaseChannel {
  constructor(config) {
    super(config);
    this.type = "telegram";
    this.bot = null;
  }

  /**
   * Retry a Telegram API call on transient network errors
   */
  async _retry(fn, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        const code = err.code || err.response?.error_code;
        const transient = ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND"].includes(code) || code === 429;
        if (!transient || i === attempts - 1) throw err;
        const delay = 1000 * (i + 1);
        console.log(`[telegram] Retrying after ${code} (attempt ${i + 2}/${attempts}, wait ${delay}ms)`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  async start() {
    this.bot = new Telegraf(this.config.botToken, {
      handlerTimeout: this.config.handlerTimeout || 300_000,
    });

    // Error handler
    this.bot.catch((err, ctx) => {
      console.error(`[telegram] Error for ${ctx.updateType}:`, err.message);
    });

    // Handle all text messages
    this.bot.on("text", async (ctx) => {
      if (!this.onMessage) return;

      const msg = createMessage({
        id: String(ctx.message.message_id),
        channelType: this.type,
        channelId: String(ctx.chat.id),
        userId: String(ctx.from.id),
        userName: ctx.from.first_name || ctx.from.username || "Unknown",
        text: ctx.message.text,
        replyToId: ctx.message.reply_to_message
          ? String(ctx.message.reply_to_message.message_id)
          : null,
        raw: ctx,
      });

      await this.onMessage(msg);
    });

    // Handle location messages
    this.bot.on("location", async (ctx) => {
      if (!this.onMessage) return;

      const { latitude, longitude } = ctx.message.location;
      const msg = createMessage({
        id: String(ctx.message.message_id),
        channelType: this.type,
        channelId: String(ctx.chat.id),
        userId: String(ctx.from.id),
        userName: ctx.from.first_name || ctx.from.username || "Unknown",
        text: "", // No text for location messages
        location: { latitude, longitude },
        replyToId: ctx.message.reply_to_message
          ? String(ctx.message.reply_to_message.message_id)
          : null,
        raw: ctx,
      });

      await this.onMessage(msg);
    });

    await this.bot.launch({ dropPendingUpdates: true });
    console.log(`[telegram] Channel started`);
  }

  async stop() {
    if (this.bot) {
      this.bot.stop("SIGTERM");
      console.log(`[telegram] Channel stopped`);
    }
  }

  async send(channelId, text) {
    if (!this.bot) throw new Error("Telegram bot not started");
    try {
      const formatted = toTelegramMarkdownV2(text);
      await this._retry(() =>
        this.bot.telegram.sendMessage(channelId, formatted, { parse_mode: "MarkdownV2" })
      );
    } catch {
      // Fallback to plain text if MarkdownV2 parsing fails
      await this._retry(() =>
        this.bot.telegram.sendMessage(channelId, stripMarkdown(text))
      );
    }
  }

  async sendTyping(channelId) {
    if (!this.bot) return;
    try {
      await this.bot.telegram.sendChatAction(channelId, "typing");
    } catch {
      // Ignore typing errors
    }
  }

  async reply(channelId, messageId, text) {
    if (!this.bot) throw new Error("Telegram bot not started");
    try {
      const formatted = toTelegramMarkdownV2(text);
      await this._retry(() =>
        this.bot.telegram.sendMessage(channelId, formatted, {
          parse_mode: "MarkdownV2",
          reply_to_message_id: Number(messageId),
        })
      );
    } catch {
      await this._retry(() =>
        this.bot.telegram.sendMessage(channelId, stripMarkdown(text), {
          reply_to_message_id: Number(messageId),
        })
      );
    }
  }

  async edit(channelId, messageId, newText) {
    if (!this.bot) throw new Error("Telegram bot not started");
    try {
      const formatted = toTelegramMarkdownV2(newText);
      await this._retry(() =>
        this.bot.telegram.editMessageText(
          channelId,
          Number(messageId),
          undefined,
          formatted,
          { parse_mode: "MarkdownV2" }
        )
      );
    } catch {
      await this._retry(() =>
        this.bot.telegram.editMessageText(
          channelId,
          Number(messageId),
          undefined,
          stripMarkdown(newText)
        )
      );
    }
  }

  /**
   * Check if a user is allowed (Telegram uses numeric IDs)
   */
  isAllowed(userId) {
    if (!this.config.allowedUserIds) return true;
    return this.config.allowedUserIds.includes(Number(userId));
  }
}

export default TelegramChannel;
