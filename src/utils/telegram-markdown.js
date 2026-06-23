/**
 * Telegram MarkdownV2 Converter
 *
 * Converts standard Markdown (as produced by Claude) into Telegram's
 * MarkdownV2 format, handling escaping and syntax differences.
 */

// Characters that must be escaped in MarkdownV2 plain text
const SPECIAL_CHARS = /[_*[\]()~`>#+\-=|{}.!\\]/g;

/**
 * Escape special characters for MarkdownV2 plain text
 */
function escapeMarkdownV2(text) {
  return text.replace(SPECIAL_CHARS, "\\$&");
}

/**
 * Convert standard Markdown to Telegram MarkdownV2.
 *
 * Strategy: extract "protected" blocks first (code blocks, inline code,
 * links), convert remaining Markdown syntax, then escape plain text.
 */
export function toTelegramMarkdownV2(md) {
  if (!md) return "";

  const tokens = [];
  let idx = 0;

  // Tokenise: pull out fenced code blocks, inline code, and links so we
  // can treat the rest as plain Markdown that needs conversion + escaping.

  const patterns = [
    // Fenced code blocks: ```lang\n...\n```
    {
      re: /```(\w*)\n([\s\S]*?)```/g,
      type: "codeblock",
    },
    // Inline code: `...`
    {
      re: /`([^`]+)`/g,
      type: "code",
    },
    // Links: [text](url)
    {
      re: /\[([^\]]+)\]\(([^)]+)\)/g,
      type: "link",
    },
  ];

  // Collect all matches with their positions
  const matches = [];
  for (const p of patterns) {
    let m;
    while ((m = p.re.exec(md)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length, match: m, type: p.type });
    }
  }
  // Sort by position
  matches.sort((a, b) => a.start - b.start);

  // Remove overlapping matches (keep earlier ones)
  const filtered = [];
  let lastEnd = 0;
  for (const m of matches) {
    if (m.start >= lastEnd) {
      filtered.push(m);
      lastEnd = m.end;
    }
  }

  // Build token list: alternating plain text and special tokens
  let cursor = 0;
  for (const m of filtered) {
    if (m.start > cursor) {
      tokens.push({ type: "text", value: md.slice(cursor, m.start) });
    }
    tokens.push({ type: m.type, match: m.match });
    cursor = m.end;
  }
  if (cursor < md.length) {
    tokens.push({ type: "text", value: md.slice(cursor) });
  }

  // Convert each token
  const parts = tokens.map((t) => {
    switch (t.type) {
      case "codeblock": {
        const lang = t.match[1] || "";
        const code = t.match[2];
        // Content inside code blocks is not escaped
        return "```" + lang + "\n" + code + "```";
      }
      case "code": {
        // Content inside inline code is not escaped
        return "`" + t.match[1] + "`";
      }
      case "link": {
        const text = escapeMarkdownV2(t.match[1]);
        const url = t.match[2];
        return "[" + text + "](" + url + ")";
      }
      case "text":
        return convertPlainMarkdown(t.value);
      default:
        return escapeMarkdownV2(t.value);
    }
  });

  return parts.join("");
}

/**
 * Convert plain Markdown text (outside of code/links) to MarkdownV2.
 * Handles bold, italic, headings, list markers, then escapes the rest.
 */
function convertPlainMarkdown(text) {
  // We process line-by-line for headings and list markers
  const lines = text.split("\n");
  const converted = lines.map((line) => {
    // Headings → bold
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      return "*" + escapeMarkdownV2(headingMatch[2]) + "*";
    }

    // Unordered list markers: - or * at start of line
    const listMatch = line.match(/^(\s*)[*\-]\s+(.+)$/);
    if (listMatch) {
      const indent = listMatch[1];
      return escapeMarkdownV2(indent) + "• " + convertInlineMarkdown(listMatch[2]);
    }

    // Ordered list markers: keep the number
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
    if (olMatch) {
      return escapeMarkdownV2(olMatch[1]) + escapeMarkdownV2(olMatch[2] + ".") + " " + convertInlineMarkdown(olMatch[3]);
    }

    // Block quote
    const bqMatch = line.match(/^>\s?(.*)$/);
    if (bqMatch) {
      return ">" + convertInlineMarkdown(bqMatch[1]);
    }

    return convertInlineMarkdown(line);
  });

  return converted.join("\n");
}

/**
 * Convert inline Markdown (bold, italic) within a line, then escape the rest.
 */
function convertInlineMarkdown(line) {
  // Bold: **text** → *text*
  // Italic: *text* or _text_ → _text_
  // Bold+Italic: ***text*** → *_text_*
  //
  // We tokenise inline formatting to avoid double-escaping.

  const inlineTokens = [];
  // Match bold+italic, bold, italic (underscore), italic (asterisk)
  const inlineRe = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_|~~(.+?)~~|\|\|(.+?)\|\|)/g;
  let cursor = 0;
  let m;
  while ((m = inlineRe.exec(line)) !== null) {
    if (m.index > cursor) {
      inlineTokens.push({ type: "plain", value: line.slice(cursor, m.index) });
    }
    if (m[2] !== undefined) {
      // Bold+italic ***text***
      inlineTokens.push({ type: "bolditalic", value: m[2] });
    } else if (m[3] !== undefined) {
      // Bold **text**
      inlineTokens.push({ type: "bold", value: m[3] });
    } else if (m[4] !== undefined) {
      // Italic *text*
      inlineTokens.push({ type: "italic", value: m[4] });
    } else if (m[5] !== undefined) {
      // Italic _text_
      inlineTokens.push({ type: "italic", value: m[5] });
    } else if (m[6] !== undefined) {
      // Strikethrough ~~text~~
      inlineTokens.push({ type: "strikethrough", value: m[6] });
    } else if (m[7] !== undefined) {
      // Spoiler ||text||
      inlineTokens.push({ type: "spoiler", value: m[7] });
    }
    cursor = m.index + m[0].length;
  }
  if (cursor < line.length) {
    inlineTokens.push({ type: "plain", value: line.slice(cursor) });
  }

  return inlineTokens
    .map((t) => {
      switch (t.type) {
        case "bold":
          return "*" + escapeMarkdownV2(t.value) + "*";
        case "italic":
          return "_" + escapeMarkdownV2(t.value) + "_";
        case "bolditalic":
          return "*_" + escapeMarkdownV2(t.value) + "_*";
        case "strikethrough":
          return "~" + escapeMarkdownV2(t.value) + "~";
        case "spoiler":
          return "||" + escapeMarkdownV2(t.value) + "||";
        case "plain":
        default:
          return escapeMarkdownV2(t.value);
      }
    })
    .join("");
}

/**
 * Strip all Markdown formatting, returning plain text.
 * Used as a fallback when MarkdownV2 send fails.
 */
export function stripMarkdown(md) {
  if (!md) return "";
  return md
    .replace(/```\w*\n([\s\S]*?)```/g, "$1")  // code blocks → content
    .replace(/`([^`]+)`/g, "$1")                // inline code → content
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")    // links → text
    .replace(/#{1,6}\s+/g, "")                  // headings → remove markers
    .replace(/(\*\*\*|___)(.*?)\1/g, "$2")      // bold+italic → content
    .replace(/(\*\*|__)(.*?)\1/g, "$2")         // bold → content
    .replace(/([*_])(.*?)\1/g, "$2")            // italic → content
    .replace(/~~(.+?)~~/g, "$1")                 // strikethrough → content
    .replace(/\|\|(.+?)\|\|/g, "$1")             // spoiler → content
    .replace(/^\s*[*\-]\s+/gm, "• ");           // list markers → bullet
}
