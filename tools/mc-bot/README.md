# mc-bot

A Mineflayer-based controllable bot for Velocity/Minecraft automation, with:

- reconnectable container runtime
- local HTTP control API
- first-person web viewer (`prismarine-viewer`)
- structured action endpoints (move/look/dig/place/craft/interact/inventory)
- short-term memory feed for agent loops

## Important

- `mineflayer@4.35.0` requires Node `>=22`.
- On this host, Node is currently `v18`, so use Docker runner unless you upgrade Node.
- Keep `MC_AUTH=microsoft` for online mode.

## Setup

```bash
cd tools/mc-bot
cp .env.example .env
```

Fill `MC_USERNAME` with your Microsoft account email.

## Run

### Docker (works even with old local Node)

```bash
npm run start:docker
```

### Docker daemon + control (recommended for Codex automation)

```bash
npm run start:docker:daemon
npm run logs:docker
```

In another terminal, control the running bot:

```bash
npm run ctl -- status
npm run ctl -- goal
npm run ctl -- goal "Gather wood and build a safe shelter"
npm run ctl -- send "/server"
npm run ctl -- reconnect
npm run ctl -- autonomy
npm run ctl -- autonomy-start
npm run ctl -- autonomy-stop
npm run ctl -- quit
```

### Local Node 22+

```bash
npm run start
```

## Browser Viewer

The bot now exposes a live first-person browser view (when enabled):

- default URL: `http://127.0.0.1:30078`
- config: `MC_VIEWER_*` in `.env`

This is the best practical way to let an external controller “see” what the bot sees.

## Control API

Enabled by default on `http://127.0.0.1:30077`:

- `GET /status`
- `GET /memory?limit=50`
- `POST /command` (raw command text or `{"command":"..."}`)
- `POST /action`
- `POST /reconnect`
- `POST /quit`
- `GET /autonomy`
- `POST /autonomy/start`
- `POST /autonomy/stop`
- `GET /goal`
- `POST /goal`

`/action` supports:

- `chat`
- `move`
- `stop`
- `look`
- `dig` / `break`
- `place`
- `equip`
- `interact`
- `useItem`
- `craft`
- `inventory`
- `observe`

## CLI Control

Use the helper script via npm:

```bash
npm run ctl -- status
npm run ctl -- goal
npm run ctl -- autonomy
npm run ctl -- observe
npm run ctl -- memory 30
npm run ctl -- send "/server"
npm run ctl -- action move '{"x":10,"y":64,"z":10,"range":1}'
npm run ctl -- action look '{"target":{"x":11,"y":65,"z":10}}'
npm run ctl -- action dig '{"x":11,"y":64,"z":10}'
npm run ctl -- action craft '{"itemName":"oak_planks","count":1}'
```

## Autonomous Mode (OpenRouter)

Set in `.env`:

- `MC_AUTONOMOUS_ENABLED=true`
- `OPENROUTER_API_KEY=...`
- `OPENROUTER_MODEL=openai/gpt-4.1-mini`

Optional tuning:

- `MC_AUTONOMOUS_TICK_MS`
- `MC_AUTONOMOUS_GOAL`
- `MC_AUTONOMOUS_ALLOWED_ACTIONS`
- `MC_AUTONOMOUS_VERBOSE_LOGS`
- `MC_AUTONOMOUS_ALLOW_DESTRUCTIVE` (default `false`)
- `MC_AUTONOMOUS_CHAT_COOLDOWN_MS`
- `MC_AUTONOMOUS_AVOID_HOLES` (default `true`, avoids digging floor/support near bot feet)
- `MC_AUTONOMOUS_SELF_REPORT_MS` (periodic "thinking out loud" status in chat)
- `MC_AUTONOMOUS_REFLECTION_ENABLED`
- `MC_AUTONOMOUS_REFLECTION_INTERVAL_MS` (set `10000` for every 10s)
- `MC_AUTONOMOUS_REFLECTION_MAX_TOKENS`
- `OPENROUTER_TEMPERATURE`
- `OPENROUTER_MAX_TOKENS`

When enabled, the bot starts the inference loop automatically after spawn and repeatedly:

1. Reads current observation + recent memory.
2. Calls OpenRouter for a JSON action decision.
3. Executes one action.
4. Stores decision/result back into memory.

Reflection loop:

- Every `MC_AUTONOMOUS_REFLECTION_INTERVAL_MS`, the bot runs a second inference pass to:
- Explain what it is thinking in chat.
- Re-evaluate and update its goal.
- Decide the next immediate step.

## In-Game Chat Control

You can control the bot directly from Minecraft chat:

- `!help`
- `!goal gather wood, then build a small shelter`
- `!status`
- `!autonomy on`
- `!autonomy off`
- `!explore on`
- `!explore off`
- `!listen`

Natural language directives (no prefix) from allowed users are also accepted and queued as high-priority instructions.
The bot will acknowledge with `[ack] ...` in chat when it heard you.

Config:

- `MC_CHAT_CONTROL_ENABLED=true`
- `MC_CHAT_CONTROL_PREFIX=!`
- `MC_CHAT_CONTROL_ADMINS=` (comma-separated usernames, optional)
- `MC_CHAT_DIRECTIVE_ENABLED=true`
- `MC_CHAT_DIRECTIVE_TTL_MS=60000`

State restore:

- `MC_STATE_RESTORE_GOAL=false` keeps your env default goal on restart.

Exploration behavior:

- `MC_AUTONOMOUS_CONTINUOUS_MOVE_ENABLED=false` by default to reduce random wandering.

## Agent Loop Direction

For an LLM “brain”, the intended loop is:

1. Read `GET /status` and `GET /memory`.
2. Decide next step.
3. Execute one `POST /action`.
4. Repeat with a safety policy (rate limits, allow-list of actions, stop conditions).

For Microsoft auth, first run may show a device auth code; complete that flow to create cached tokens in `.profiles`.

## Velocity auto-join behavior

- `MC_TARGET_SERVER_PREFIX` controls auto-selected backend prefix from `/server` output (default `survival-`).
- `MC_AUTO_JOIN_COMMAND_TEMPLATE` controls join command format (default `/server {server}`).
