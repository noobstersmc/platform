# mc-bot

A minimal Mineflayer test client for validating Velocity `/server` behavior as a real player.

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
npm run ctl -- send "/server"
npm run ctl -- reconnect
npm run ctl -- quit
```

### Local Node 22+

```bash
npm run start
```

## Usage

After login/spawn, use stdin commands:

- `/server`
- `/server lobby-0-xxxxxx`
- `/server creative-xxxxxx-xxxxxx`
- `:where` (runs `/proxyops where`)
- `:servers` (runs `/server`)
- `:reconnect`
- `:quit`

For Microsoft auth, first run may show a device auth code; complete that flow to create cached tokens in `.profiles`.

## Control API

Enabled by default for local automation:

- `GET /status`
- `POST /command` (plain text body or `{"command":"..."}`)
- `POST /reconnect`
- `POST /quit`

Config in `.env`:

- `MC_CONTROL_ENABLED=true`
- `MC_CONTROL_HOST=127.0.0.1`
- `MC_CONTROL_PORT=30077`
- `MC_CONTROL_TOKEN=` (optional bearer token)

Reconnect behavior is configurable with:

- `MC_AUTO_RECONNECT=true`
- `MC_RECONNECT_DELAY_MS=5000`
