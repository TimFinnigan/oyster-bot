# 🦪 Oyster Bot

> Inspired by [OpenClaw](https://github.com/openclaw/openclaw) — but ultra-lightweight and very straightforward. No gateway, no daemon, no native apps. Just a simple bot that wraps AI CLIs (Claude Code or Codex) and sends responses to your messaging app.

<img src="oyster.png" width="150" alt="Oyster">

Chat with Claude or Codex, search the web, read files, and run commands-all from your phone.

## Features

- **Conversational AI** — Chat through Telegram using Claude CLI or Codex CLI
- **Session continuity** — Maintains conversation history per chat
- **Streaming logs** — See Claude's thinking and tool usage in real-time
- **Configurable tools** — Control which tools Claude can use
- **User whitelist** — Restrict access to specific Telegram users
- **Budget caps** — Limit spending per request

## Prerequisites

- Node.js 18+
- [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) and/or Codex CLI installed and authenticated
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

### Optional - Telegram Media

| Variable | Default | Description |
|----------|---------|-------------|
| `TELEGRAM_MEDIA_DIR` | `./data/telegram-media` | Directory where incoming Telegram files (photos/documents) are saved so Claude/Codex can read them |
| `TELEGRAM_MEDIA_MAX_MB` | `15` | Maximum allowed attachment size in megabytes (also configurable via `TELEGRAM_MEDIA_MAX_BYTES`) |
| `TELEGRAM_MEDIA_MAX_BYTES` | Derived from `TELEGRAM_MEDIA_MAX_MB` | Explicit byte ceiling for attachments; overrides the MB setting |

### Optional - AI Provider

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_PROVIDER` | `claude` | Active provider (`claude` or `codex`) |

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

### Optional - Codex CLI Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `CODEX_PATH` | `codex` | Path to Codex CLI executable |
| `CODEX_TIMEOUT_MS` | `180000` | Codex process timeout (3 min) |
| `CODEX_MODEL` | (none) | Optional Codex model override |
| `CODEX_EXTRA_PATH` | (see config.js) | Additional PATH for Codex subprocess |

### Optional - Plugin Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `DATA_DIR` | `./data` | Directory for plugin data files (logs, reminders, todos, etc.) |
| `PLUGIN_DIR` | `./plugins` | Primary plugin directory |
| `PLUGIN_DIRS` | (none) | Comma-separated plugin directories. If set, overrides `PLUGIN_DIR` |
| `PLUGIN_TARGET_CHAT_ID` | (none) | Your Telegram user ID for receiving scheduled messages |
| `QUOTES_CRON` | `0 * * * *` | Cron schedule for quotes (default: hourly) |
| `WEATHER_DEFAULT_LOCATION` | (none) | Default location for weather (e.g., "Seattle, WA") |
| `WEATHER_CRON` | `0 8 * * *` | Cron schedule for daily weather (default: 8am) |
| `ORCHESTRATOR_CRON` | `0 9 * * *` | Cron schedule for orchestrator check-ins (default: 9am) |
| `ORCHESTRATOR_ENABLED` | `true` | Enable/disable scheduled orchestrator check-ins |

### Example `.env`

```bash
TELEGRAM_BOT_TOKEN=your-telegram-bot-token

# Only needed if using API key instead of Pro/Max subscription
# ANTHROPIC_API_KEY=sk-ant-api03-...

# Restrict to your Telegram user ID
ALLOWED_USER_IDS=123456789

# Provider: claude or codex
AI_PROVIDER=claude

# Allow git and npm commands
CLAUDE_ALLOWED_TOOLS=Read,Glob,Grep,WebSearch,WebFetch,Bash(git *),Bash(npm *)

# Grant access to additional directories (beyond working dir)
# CLAUDE_ALLOWED_DIRECTORIES=/Users/me/projects,/Users/me/notes

# Optional runtime paths
# DATA_DIR=./data
# PLUGIN_DIR=./plugins
# PLUGIN_DIRS=./plugins,./custom-plugins

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

### Sending Images from Telegram

1. (Optional) Set `TELEGRAM_MEDIA_DIR` in `.env` if you want downloaded files to live somewhere other than `./data/telegram-media`.  
2. Send a photo (or an image document) to your Telegram bot. Add a caption if you want the text included with the request.  
3. Oyster bot downloads the file, stores it locally, and appends a short summary to your prompt that lists the absolute path (so Claude/Codex can `Read` it).  
4. In your follow-up instructions you can reference the provided path directly, e.g. “Please describe the screenshot saved at `/Users/me/oyster/data/telegram-media/2025-02-09-...jpg`.”  

Files larger than the configured limit (default 15 MB) are rejected and you’ll get a friendly reminder in Telegram.

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
| `/switch <claude\|codex>` | Switch active AI provider |

## Plugins

The bot supports a plugin system for adding custom commands and scheduled tasks. Plugins are auto-loaded from `PLUGIN_DIR` (default `./plugins`) or all directories listed in `PLUGIN_DIRS`.

**Note:** Plugin commands use `.` prefix (e.g., `.quote`) instead of `/` to avoid conflicts with Claude's slash commands.

### Included Plugins

**Admin Plugin** (`plugins/admin.js`)

Bot management shortcuts:
- `.status` — Show bot uptime, memory usage, Node version, PID
- `.reload` — Hot reload all plugins without restarting Node
- `.restart` — Restart the PM2 process (`pm2 restart oyster-bot`)
- `.stop` — Stop the bot (use `.restart` or PM2 to bring it back)

**Git Plugin** (`plugins/git.js`)

End-to-end git workflow without leaving Telegram:
- `.changes` — Summarize staged + unstaged changes (uses Claude/Codex)
- `.git` — Show current branch + short status
- `.branch [name]` — Create/switch feature branches (auto-names if blank)
- `.commit [msg]` — Stage everything and commit (AI commit message if blank)
- `.push` — Push `HEAD` to origin
- `.pr [title]` — Create a GitHub PR with AI-generated title/body
- `.merge [squash|merge|rebase]` — Merge the open PR and clean up
- `.ship [branch?]` — All-in-one branch → commit → push → PR → merge flow  
  _(If Claude hits its quota, the plugin auto-falls back to Codex so PR text still gets generated.)_

**Feature Request Plugin** (`plugins/feature.js`)

Claude brainstorms or implements GitHub issues (requires authenticated `gh` CLI):
- `.feature` — Brainstorm one feature request and open an issue
- `.feature 3` — Brainstorm N ideas (max 5) and open issues for each
- `.feature <idea text>` — Skip brainstorming and file a specific request
- `.feature do <issue#>` — Ask Claude to implement an existing GitHub issue

**Help Plugin** (`plugins/help.js`)
- `.help` — List every registered command grouped by plugin (great when new plugins are added)

**Plugins Plugin** (`plugins/plugins.js`)
- `.plugins` — List all loaded plugins with enabled/disabled status
- `.plugins enable <name>` — Enable a plugin for you
- `.plugins disable <name>` — Disable a plugin for you

Disabling a plugin suppresses its **scheduled alerts** (e.g. daily episode ping, gratitude reminder). Plugin commands (e.g. `.shows list`) still work regardless. Settings are per-user and persist across restarts.

You can also disable plugins for everyone by default via `.env`:
```bash
PLUGIN_DEFAULT_DISABLED=shows,gratitude
```

**Auto Plugin** (`plugins/auto.js`)

Automate any other command on a repeating interval:
- `.auto add 4h .feature` — Run `.feature` every 4 hours
- `.auto add 1d .feature do 12` — Implement issue #12 once per day
- `.auto list` / `.auto remove <id|number>` / `.auto run <id|number>` — Manage your automations

Intervals accept `s`, `m`, `h`, `d` units (e.g., `30m`, `6h`, `2d`). Commands run as you, in the same chat where you added them.

**Quotes Plugin** (`plugins/quotes.js`)
- `.quote` — Get a real inspiring quote (no repeats; logged to disk)
- Scheduled job sends a daily quote to `PLUGIN_TARGET_CHAT_ID` (cron configurable via `QUOTES_CRON`)

**Recipe Plugin** (`plugins/recipe.js`)
- `.recipe chicken, rice, garlic --quick --vegetarian` — Generates a single practical recipe  
  Flags: `--vegetarian`, `--vegan`, `--quick` (≤30 min)

**Reminder Plugin** (`plugins/reminder.js`)
- `.reminder <text> <time>` — e.g., `.reminder pay rent 2h`
- `.reminders` — Numbered list of pending reminders (IDs still shown)
- `.cancelreminder <number|id>` — Cancel by list number **or** unique ID
- `.reminderlog` — View recently completed reminders
- `.every <time> <text>` — Daily reminder (also accepts weekdays like `mon 8am stretch`)
- `.recurring` — View/manage recurring reminders

**Weather Plugin** (`plugins/weather.js`)
- `.weather` — Prompt to share your location, or use your default location
- `.weather <city>` — Fetch weather for a specific place using Open‑Meteo
- Scheduled daily forecast (default 8 AM) controlled by `WEATHER_CRON`

**Orchestrator Plugin** (`plugins/orchestrator.js`)

A self-organizing agent that runs daily check-ins, tracks ideas, and executes tasks.

Commands:
- `.goal <text>` / `.goals` / `.rmgoal <n>`
- `.oidea <text>` — Manually seed ideas for your main goal
- `.ideas` — View tracked ideas grouped by status
- `.checkin` — Run the AI planning loop now instead of waiting for cron
- `.ocook [n]` — Auto-run N check-ins (default 1) and auto-approve them (great before bed)
- `.approve` / `.reject [feedback]` — Review pending proposals
- `.ostatus` — Show recent activity + whether a proposal is waiting
- `.results` — Dump today’s execution outputs (after `.approve` or `.ocook`)

Example workflow:
```
.goal Build an audience around AI content - I have a newsletter

.checkin
# -> Claude proposes 2–3 actions
.approve
# -> Actions execute automatically; later run .results to read the drafts/research
```

**Routine Breaker Plugin** (`../local-oyster-bot-plugins/active/routine-breaker.js`)
- `.routine` — Get a quick suggestion to shake up your day (different weekday/weekend zones)
- Also schedules one random suggestion between 9 AM–12 PM daily

**Keepalive Plugin** (`plugins/keepalive.js`)
- No commands; simply logs a heartbeat every 5 minutes so the event loop stays warm

**Quotes/Weather target chat**

Set `PLUGIN_TARGET_CHAT_ID` (and optionally `plugins.targetChannel`) in `.env` so scheduled plugins know which chat to message.

Configure in `.env`:
```bash
ORCHESTRATOR_CRON=0 9 * * *   # Daily at 9am (default)
ORCHESTRATOR_ENABLED=true     # Enable scheduled check-ins
```

Configure in `.env`:
```bash
# Optional runtime paths
# DATA_DIR=./data
# PLUGIN_DIR=./plugins
# PLUGIN_DIRS=./plugins,./custom-plugins

# Your Telegram user ID (required for scheduled messages)
PLUGIN_TARGET_CHAT_ID=123456789

# Quotes schedule (cron format, default: hourly)
QUOTES_CRON=0 9 * * *

# Weather settings
WEATHER_DEFAULT_LOCATION=Seattle, WA
WEATHER_CRON=0 8 * * *

# Orchestrator settings
ORCHESTRATOR_CRON=0 9 * * *
# ORCHESTRATOR_ENABLED=true
```

### Local/Private Plugins

For plugins you don't want to commit, put them in `plugins/local/` — it's gitignored and the plugin loader finds them automatically.

### Creating Your Own Plugin

Create a `.js` file in your configured plugin directory (`PLUGIN_DIR` by default):

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
- `claude(prompt)` — Run a prompt through the active AI provider (Claude or Codex)
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
│   ├── ai.js             # Provider router (Claude/Codex)
│   ├── claude.js         # Claude CLI wrapper with streaming
│   ├── codex.js          # Codex CLI wrapper
│   ├── config.js         # Centralized configuration
│   ├── plugin-loader.js  # Plugin discovery and registration
│   ├── channels/         # Channel adapters
│   │   ├── base.js       # BaseChannel interface
│   │   ├── telegram.js   # Telegram implementation
│   │   └── index.js      # Channel registry
│   └── types/
│       └── message.js    # Unified message type
├── plugins/              # Plugin directory (add your own here)
│   ├── admin.js          # Admin commands (reload/restart/status/stop)
│   ├── auto.js           # Run other commands on a timer
│   ├── feature.js        # GitHub feature request automation
│   ├── git.js            # AI-assisted git workflow helpers
│   ├── help.js           # Lists all available commands
│   ├── keepalive.js      # Background heartbeat
│   ├── orchestrator.js   # Goal tracking and daily execution
│   ├── quotes.js         # Motivational quotes
│   ├── recipe.js         # Ingredient → recipe generator
│   ├── reminder.js       # One-off + recurring reminders
│   └── weather.js        # Open-Meteo weather summaries
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
         │ (routing, sessions, provider, etc.) │
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
2. Bot picks the active provider (`claude` or `codex`)
3. Bot spawns the matching CLI and sends your prompt
4. Streaming events are logged in real-time (thinking, tool use, etc.)
5. Final response is sent back to the user in Telegram

Sessions are maintained per chat, allowing for continuous conversations. Use `/reset` to start fresh.

## Security Considerations

- **User whitelist**: Always set `ALLOWED_USER_IDS` in production
- **Tool restrictions**: Start with read-only tools, add write/execute access carefully
- **Budget caps**: Keep `CLAUDE_MAX_BUDGET_USD` low to prevent runaway costs
- **Skip permissions**: Only use `CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS` if you trust all whitelisted users

## Troubleshooting

### Claude Code session crashes or becomes unresponsive

If Claude Code stops responding (e.g. the bot hangs or errors persist), `pm2 restart` won't fix it — that only restarts the bot process, not the underlying Claude Code session.

**Fix:** Delete the PM2 process and recreate it:

```bash
pm2 delete oyster-bot
pm2 start ecosystem.config.cjs
```

### Claude Pro/Max subscription expired

If your Claude Pro/Max subscription has lapsed, Claude Code will fail silently or throw auth errors. Renew your subscription at [claude.ai](https://claude.ai), then start a fresh Claude Code instance (see above). A simple `pm2 restart` is not sufficient — you need to fully delete and recreate the process so Claude Code re-authenticates.

## License

MIT
