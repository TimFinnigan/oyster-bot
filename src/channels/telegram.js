/**
 * Telegram Channel Adapter
 * 
 * Implements the BaseChannel interface for Telegram using Telegraf.
 */

import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { extname, join } from "path";
import { Telegraf } from "telegraf";
import { BaseChannel } from "./base.js";
import { createMessage } from "../types/message.js";
import { toTelegramMarkdownV2, stripMarkdown } from "../utils/telegram-markdown.js";

export class TelegramChannel extends BaseChannel {
  constructor(config) {
    super(config);
    this.type = "telegram";
    this.bot = null;
    this.mediaDir = config.mediaDir;
    this.maxAttachmentBytes = config.maxAttachmentBytes;
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

  async _createUnifiedMessage(ctx) {
    const attachments = await this._collectAttachments(ctx);
    const attachmentSummary = this._formatAttachmentSummary(attachments);
    const baseText = ctx.message.text || ctx.message.caption || "";
    const textParts = [];
    if (baseText) textParts.push(baseText);
    if (attachmentSummary) textParts.push(attachmentSummary);

    return createMessage({
      id: String(ctx.message.message_id),
      channelType: this.type,
      channelId: String(ctx.chat.id),
      userId: String(ctx.from.id),
      userName: ctx.from.first_name || ctx.from.username || "Unknown",
      text: textParts.join("\n\n"),
      location: ctx.message.location
        ? {
            latitude: ctx.message.location.latitude,
            longitude: ctx.message.location.longitude,
          }
        : null,
      attachments,
      replyToId: ctx.message.reply_to_message
        ? String(ctx.message.reply_to_message.message_id)
        : null,
      raw: ctx,
    });
  }

  async _collectAttachments(ctx) {
    const attachments = [];
    if (!this.mediaDir) return attachments;
    const chatId = String(ctx.chat.id);

    const candidates = [];

    if (Array.isArray(ctx.message.photo) && ctx.message.photo.length > 0) {
      const bestSize = ctx.message.photo[ctx.message.photo.length - 1];
      candidates.push({
        chatId,
        fileId: bestSize.file_id,
        fileUniqueId: bestSize.file_unique_id,
        type: "image",
        subtype: "photo",
        mimeType: "image/jpeg",
        fileSize: bestSize.file_size,
        metadata: {
          width: bestSize.width,
          height: bestSize.height,
        },
      });
    }

    const document = ctx.message.document;
    if (document && document.mime_type?.startsWith("image/")) {
      candidates.push({
        chatId,
        fileId: document.file_id,
        fileUniqueId: document.file_unique_id,
        type: "image",
        subtype: "document",
        mimeType: document.mime_type,
        fileName: document.file_name,
        fileSize: document.file_size,
      });
    }

    for (const candidate of candidates) {
      try {
        const saved = await this._downloadTelegramFile(candidate);
        if (saved) attachments.push(saved);
      } catch (err) {
        console.error("[telegram] Failed to download attachment:", err);
        await this.send(
          chatId,
          "I couldn't download that file (possibly due to size limits). Please try again or adjust TELEGRAM_MEDIA_MAX_MB."
        );
      }
    }

    return attachments;
  }

  async _downloadTelegramFile({
    chatId,
    fileId,
    fileUniqueId,
    type,
    subtype,
    mimeType,
    metadata = {},
    fileName = null,
    fileSize = null,
  }) {
    if (!this.bot) return null;
    if (!this.mediaDir) return null;

    const limit = this.maxAttachmentBytes;
    if (limit && fileSize && fileSize > limit) {
      await this.send(
        chatId,
        `File rejected: ${this._formatBytes(fileSize)} exceeds the configured limit of ${this._formatBytes(limit)}.`
      );
      return null;
    }

    const link = await this.bot.telegram.getFileLink(fileId);
    const fileUrl = typeof link === "string" ? link : link.href || String(link);
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Telegram file download failed with status ${response.status}`);
    }

    const resolvedMime = mimeType || response.headers.get("content-type") || "application/octet-stream";
    const buffer = Buffer.from(await response.arrayBuffer());

    if (limit && buffer.length > limit) {
      await this.send(
        chatId,
        `File rejected: ${this._formatBytes(buffer.length)} exceeds the configured limit of ${this._formatBytes(limit)}.`
      );
      return null;
    }

    await mkdir(this.mediaDir, { recursive: true });
    const sanitizedName = (fileName || fileUniqueId || randomUUID()).replace(/[^a-zA-Z0-9._-]/g, "_");
    const hasExtension = Boolean(extname(sanitizedName));
    const derivedExtension = hasExtension ? "" : this._extensionFromUrl(fileUrl) || this._extensionFromMime(resolvedMime);
    const finalName = `${Date.now()}-${sanitizedName}${derivedExtension || ""}`;
    const filePath = join(this.mediaDir, finalName);
    await writeFile(filePath, buffer);

    return {
      id: fileId,
      type,
      subtype,
      mimeType: resolvedMime,
      size: buffer.length,
      filePath,
      originalUrl: fileUrl,
      originalFileName: fileName,
      metadata,
    };
  }

  _formatAttachmentSummary(attachments) {
    if (!attachments || attachments.length === 0) return "";
    const lines = attachments.map((attachment, idx) => {
      const dims =
        attachment.metadata?.width && attachment.metadata?.height
          ? ` ${attachment.metadata.width}x${attachment.metadata.height}px`
          : "";
      const sizeLabel = typeof attachment.size === "number" ? `, ${this._formatBytes(attachment.size)}` : "";
      return `Attachment ${idx + 1}: ${attachment.subtype || attachment.type}${dims}${sizeLabel}. Saved at ${attachment.filePath}.`;
    });
    lines.push("Use the Read tool on the path(s) above to inspect the file contents.");
    return lines.join("\n");
  }

  _formatBytes(bytes) {
    if (typeof bytes !== "number" || Number.isNaN(bytes)) return "";
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const exponent = Math.min(
      units.length - 1,
      Math.floor(Math.log(bytes) / Math.log(1024))
    );
    const value = bytes / 1024 ** exponent;
    return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
  }

  _extensionFromMime(mimeType) {
    if (!mimeType) return "";
    const map = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp",
      "image/gif": ".gif",
      "image/heic": ".heic",
      "image/heif": ".heif",
    };
    return map[mimeType.toLowerCase()] || "";
  }

  _extensionFromUrl(url) {
    try {
      return extname(new URL(url).pathname);
    } catch {
      return "";
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

    // Handle any message type (text, captions, media, etc.)
    this.bot.on("message", async (ctx) => {
      if (!this.onMessage) return;
      try {
        const msg = await this._createUnifiedMessage(ctx);
        if (!msg) return;
        await this.onMessage(msg);
      } catch (err) {
        console.error("[telegram] Failed to normalize message:", err);
        await this.send(String(ctx.chat.id), "Sorry, something went wrong processing that message.");
      }
    });

    const maxRetries = 5;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.bot.launch({ dropPendingUpdates: true });
        console.log(`[telegram] Channel started`);
        return;
      } catch (err) {
        const is409 = err?.response?.error_code === 409;
        if (is409 && attempt < maxRetries) {
          const delay = attempt * 5000;
          console.warn(`[telegram] 409 conflict (attempt ${attempt}/${maxRetries}), retrying in ${delay / 1000}s...`);
          await new Promise((r) => setTimeout(r, delay));
        } else {
          throw err;
        }
      }
    }
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
