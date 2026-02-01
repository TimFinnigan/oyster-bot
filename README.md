# 🦪 Oyster Bot

> Inspired by [OpenClaw](https://github.com/openclaw/openclaw) — but ultra-lightweight and very straightforward. No gateway, no daemon, no native apps. Just a simple bot that wraps [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) and sends responses to your messaging app.

<img src="oyster.png" width="150" alt="Oyster">

Chat with Claude, search the web, read files, and run commands—all from your phone.

## Features

- **Conversational AI** — Chat with Claude through Telegram
- **Session continuity** — Maintains conversation history per chat
- **Streaming logs** — See Claude's thinking and tool usage in real-time
- **Configurable tools** — Control which tools Claude can use
- **User whitelist** — Restrict access to specific Telegram users
- **Budget caps** — Limit spending per request

## Prerequisites

- Node.js 18+
- [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) installed and authenticated
- A Telegram bot token (see below)

### Claude Code Authentication

Claude Code supports two authentication methods:

1. **Pro/Max subscription** (recommended) — Log in with your Claude account credentials. Your subscription includes Claude Code usage.
2. **API key** — Set `ANTHROPIC_API_KEY` for pay-as-you-go usage.

To authenticate with your Pro/Max plan, run `claude` and follow the login prompts. If you're switching from an API key, run `/logout` first, then `claude update`, restart your terminal, and log in again.

> **Note:** If `ANTHROPIC_API_KEY` is set in your environment, Claude Code will use it instead of your subscription, resulting in API charges. Unset it to use your Pro/Max plan.

## Getting a Telegram Bot Token

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot` to create a new bot
3. Choose a display name (e.g., "My Claude Bot")
4. Choose a username ending in `bot` (e.g., `my_claude_bot`)
5. BotFather will give you a token like `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`
6. Copy this token to your `.env` file as `TELEGRAM_BOT_TOKEN`

**Finding your Telegram User ID** (for access control):
1. Message [@userinfobot](https://t.me/userinfobot) on Telegram
2. It will reply with your user ID
3. Add this to `ALLOWED_USER_IDS` in your `.env`

## Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd oyster-bot

# Install dependencies
npm install

# Copy the example env file and configure
cp .env.example .env
```

## Configuration

Create a `.env` file with the following variables:

### Required

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Your Telegram bot token from @BotFather |

### Optional - API Key (only if not using Pro/Max subscription)

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key (for pay-as-you-go usage) |

### Optional - Access Control

| Variable | Default | Description |
|----------|---------|-------------|
| `ALLOWED_USER_IDS` | (all users) | Comma-separated Telegram user IDs to whitelist |

### Optional - Telegram Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `HANDLER_TIMEOUT_MS` | `300000` | Telegraf handler timeout (5 min) |
| `MAX_MESSAGE_LENGTH` | `4096` | Max chars before splitting messages |

### Optional - Claude CLI Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_PATH` | `claude` | Path to Claude CLI executable |
| `CLAUDE_TIMEOUT_MS` | `120000` | Claude process timeout (2 min) |
| `CLAUDE_MAX_BUDGET_USD` | `1` | Max spend per request in USD |
| `CLAUDE_ALLOWED_TOOLS` | `Read,Glob,Grep,WebSearch,WebFetch` | Tools that run without permission prompts |
| `CLAUDE_EXTRA_PATH` | (see config.js) | Additional PATH for Claude subprocess |
| `CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS` | `false` | Skip all permission prompts (use with caution) |
| `CLAUDE_VERBOSE_LOGGING` | `false` | Log all streaming event types |
| `CLAUDE_ALLOWED_DIRECTORIES` | (none) | Additional directories Claude can access (beyond working dir) |

### Optional - Plugin Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `PLUGIN_TARGET_CHAT_ID` | (none) | Your Telegram user ID for receiving scheduled messages |
| `QUOTES_CRON` | `0 * * * *` | Cron schedule for quotes (default: hourly) |
| `WEATHER_DEFAULT_LOCATION` | (none) | Default location for weather (e.g., "Seattle, WA") |
| `WEATHER_CRON` | `0 8 * * *` | Cron schedule for daily weather (default: 8am) |

### Example `.env`

```bash
TELEGRAM_BOT_TOKEN=your-telegram-bot-token

# Only needed if using API key instead of Pro/Max subscription
# ANTHROPIC_API_KEY=sk-ant-api03-...

# Restrict to your Telegram user ID
ALLOWED_USER_IDS=123456789

# Allow git and npm commands
CLAUDE_ALLOWED_TOOLS=Read,Glob,Grep,WebSearch,WebFetch,Bash(git *),Bash(npm *)

# Grant access to additional directories (beyond working dir)
# CLAUDE_ALLOWED_DIRECTORIES=/Users/me/projects,/Users/me/notes

# Plugins: receive scheduled messages
PLUGIN_TARGET_CHAT_ID=123456789
QUOTES_CRON=0 9 * * *
WEATHER_DEFAULT_LOCATION=Seattle, WA
WEATHER_CRON=0 8 * * *
```

## Available Tools

Claude can use these tools (configure with `CLAUDE_ALLOWED_TOOLS`):

| Tool | Description |
|------|-------------|
| `Read` | Read files from the filesystem |
| `Edit` | Edit/modify files |
| `Write` | Write new files |
| `Bash` | Execute shell commands (supports patterns) |
| `Grep` | Search text in files |
| `Glob` | Find files by pattern |
| `WebSearch` | Search the web |
| `WebFetch` | Fetch content from URLs |
| `Task` | Spawn sub-agents |

### Bash Patterns

Use wildcards to allow specific commands:

```bash
# All git commands
Bash(git *)

# All npm commands  
Bash(npm *)

# Only git status and diff
Bash(git status),Bash(git diff *)

# Any command ending in --help
Bash(* --help)
```

## Usage

### Development

```bash
# Start the bot (foreground)
npm start

# Or run directly
node src/app.js
```

### Production (with PM2)

For production use, run with [PM2](https://pm2.keymetrics.io/) for automatic restarts and crash recovery:

```bash
# Install PM2 globally
npm install -g pm2

# Start with the included config
pm2 start ecosystem.config.cjs

# View logs
pm2 logs oyster-bot

# Other useful commands
pm2 list              # Show status
pm2 restart oyster-bot  # Manual restart
pm2 stop oyster-bot     # Stop the bot
pm2 delete oyster-bot   # Remove from PM2

# Make it survive reboots (optional)
pm2 save
pm2 startup
```

The PM2 config includes crash loop protection:
- Max 10 restarts before giving up
- Exponential backoff between restarts
- Memory limit restart at 200MB

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Show welcome message and help |
| `/reset` | Clear conversation history |
| `/session` | Show current session ID |

## Plugins

The bot supports a plugin system for adding custom commands and scheduled tasks. Plugins are auto-loaded from the `plugins/` directory.

**Note:** Plugin commands use `.` prefix (e.g., `.quote`) instead of `/` to avoid conflicts with Claude's slash commands.

### Included Plugins

**Admin Plugin** (`plugins/admin.js`)
- `.status` — Show bot uptime, memory usage, and PID
- `.reload` — Hot reload all plugins without restarting the process
- `.restart` — Full process restart (requires PM2)

**Quotes Plugin** (`plugins/quotes.js`)
- `.quote` — Get an AI-generated motivational quote on demand
- Scheduled quotes — Sends you a positive message on a schedule

**Food Diary Plugin** (`plugins/food-diary.js`)
- `.food <item>` — Log what you ate
- `.food` — Prompts you then logs your response
- `.foodlog` — View your recent food entries

**Reminder Plugin** (`plugins/reminder.js`)
- `.reminder <text> <time>` — Set a reminder (e.g., `.reminder call mom 30m`)
- `.reminders` — View your pending reminders
- `.cancelreminder <id>` — Cancel a reminder by ID
- Time formats: `30s`, `5m`, `2h`, `1d` (seconds, minutes, hours, days)

**Weather Plugin** (`plugins/weather.js`)
- `.weather` — Get weather for your default location (or share location on Telegram)
- `.weather <location>` — Get weather for a specific place
- Scheduled weather — Sends daily weather report

Configure in `.env`:
```bash
# Your Telegram user ID (required for scheduled messages)
PLUGIN_TARGET_CHAT_ID=123456789

# Quotes schedule (cron format, default: hourly)
QUOTES_CRON=0 9 * * *

# Weather settings
WEATHER_DEFAULT_LOCATION=Seattle, WA
WEATHER_CRON=0 8 * * *
```

### Creating Your Own Plugin

Create a `.js` file in the `plugins/` folder:

```javascript
export default {
  name: 'my-plugin',
  
  // Custom commands triggered by .commandName (optional)
  commands: {
    hello: async (msg, { reply, sendTyping, claude, config }) => {
      await reply('Hello from my plugin!');
    }
  },
  
  // Scheduled tasks (optional)
  schedules: [
    {
      cron: '0 12 * * *',  // noon daily
      handler: async ({ channels, config, claude }) => {
        const chatId = config.plugins.targetChatId;
        const channel = channels.get('telegram');
        await channel.send(chatId, 'Lunch time!');
      }
    }
  ],
  
  // Message handler for follow-up input (optional)
  onMessage: async (msg, { reply }) => {
    // Return true if handled, false to pass to next handler
    return false;
  }
}
```

**Plugin API:**
- `msg` — Unified message object (see `src/types/message.js`)
  - `msg.text` — Message text
  - `msg.userId` — Sender's user ID
  - `msg.channelType` — Channel type ('telegram', etc.)
  - `msg.channelId` — Chat/room ID
- `reply(text)` — Send a response to the same channel
- `sendTyping()` — Show typing indicator
- `claude(prompt)` — Run a prompt through Claude CLI
- `config` — App configuration object
- `channels` — Map of channel instances (for scheduled tasks)

**Cron format:** `minute hour day month weekday`
- `* * * * *` — every minute
- `0 * * * *` — every hour
- `0 9 * * *` — 9am daily
- `0 9 * * 1` — 9am every Monday

## Project Structure

```
oyster-bot/
├── src/
│   ├── app.js            # Main entrypoint (channel-agnostic)
│   ├── claude.js         # Claude CLI wrapper with streaming
│   ├── config.js         # Centralized configuration
│   ├── plugin-loader.js  # Plugin discovery and registration
│   ├── channels/         # Channel adapters
│   │   ├── base.js       # BaseChannel interface
│   │   ├── telegram.js   # Telegram implementation
│   │   └── index.js      # Channel registry
│   └── types/
│       └── message.js    # Unified message type
├── plugins/              # Plugin directory (add your own here)
│   ├── admin.js          # Admin commands (reload, restart, status)
│   ├── quotes.js         # Motivational quotes plugin
│   ├── food-diary.js     # Food diary plugin
│   ├── reminder.js       # Reminders plugin
│   └── weather.js        # Weather plugin
├── ecosystem.config.cjs  # PM2 process manager config
├── package.json
├── .env                  # Environment variables (not committed)
└── README.md
```

## Architecture

The bot uses a channel-agnostic design that makes it easy to add support for new messaging platforms:

```
         ┌───────────────────────────────────┐
         │              app.js               │
         │ (routing, sessions, Claude, etc.) │
         └─────────────────┬─────────────────┘
                           │
                 ┌─────────┴─────────┐
                 │  Unified Message  │
                 └─────────┬─────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
   ┌──────────┐      ┌──────────┐      ┌──────────┐
   │ Telegram │      │ Discord  │      │  Slack   │
   │          │      │ (future) │      │ (future) │
   └──────────┘      └──────────┘      └──────────┘
```

### Adding a New Channel

1. Create `src/channels/yourplatform.js` extending `BaseChannel`
2. Implement `start()`, `stop()`, `send()`, `sendTyping()`
3. Convert incoming messages to unified `Message` format
4. Register in `src/channels/index.js`
5. Add config in `src/config.js`

## How It Works

1. User sends a message to the Telegram bot
2. Bot spawns the Claude CLI with `--print --output-format stream-json`
3. Claude processes the request using allowed tools
4. Streaming events are logged in real-time (thinking, tool use, etc.)
5. Final response is sent back to the user in Telegram

Sessions are maintained per chat, allowing for continuous conversations. Use `/reset` to start fresh.

## Security Considerations

- **User whitelist**: Always set `ALLOWED_USER_IDS` in production
- **Tool restrictions**: Start with read-only tools, add write/execute access carefully
- **Budget caps**: Keep `CLAUDE_MAX_BUDGET_USD` low to prevent runaway costs
- **Skip permissions**: Only use `CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS` if you trust all whitelisted users

## License

MIT
