#!/usr/bin/env node

require('dotenv').config()
const http = require('http')
const mineflayer = require('mineflayer')
const readline = require('readline')

function env(name, def) {
  const v = process.env[name]
  return v === undefined || v === '' ? def : v
}

const config = {
  host: env('MC_HOST', '127.0.0.1'),
  port: Number(env('MC_PORT', '25577')),
  version: env('MC_VERSION', '1.21.4'),
  auth: env('MC_AUTH', 'microsoft'),
  username: env('MC_USERNAME', ''),
  password: env('MC_PASSWORD', ''),
  profileFolder: env('MC_PROFILE_FOLDER', '.profiles'),
  startCommands: env('MC_START_COMMANDS', '/server')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  reconnectDelayMs: Number(env('MC_RECONNECT_DELAY_MS', '5000')),
  autoReconnect: env('MC_AUTO_RECONNECT', 'true') !== 'false',
  controlEnabled: env('MC_CONTROL_ENABLED', 'true') !== 'false',
  controlHost: env('MC_CONTROL_HOST', '127.0.0.1'),
  controlPort: Number(env('MC_CONTROL_PORT', '30077')),
  controlToken: env('MC_CONTROL_TOKEN', ''),
}

let bot = null
let reconnectTimer = null
let shuttingDown = false
let spawnHandled = false
let connected = false

function buildBotOptions() {
  const options = {
    host: config.host,
    port: config.port,
    version: config.version,
    auth: config.auth,
    checkTimeoutInterval: 30 * 1000,
    onMsaCode: (code) => {
      console.log('[MSA] Complete device auth:', code)
    },
  }

  if (config.auth === 'microsoft') {
    options.username = config.username
    options.password = config.password || undefined
    options.profilesFolder = config.profileFolder
  } else {
    options.username = config.username || env('MC_OFFLINE_NAME', 'NoobstersProbe')
  }

  return options
}

function scheduleReconnect(reason) {
  if (!config.autoReconnect || shuttingDown || reconnectTimer) return
  console.log(`[RECONNECT] scheduling in ${config.reconnectDelayMs}ms (${reason || 'unknown'})`)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect('scheduled reconnect')
  }, config.reconnectDelayMs)
}

function connect(reason) {
  if (shuttingDown) return
  if (bot) {
    try {
      bot.removeAllListeners()
      bot.quit('reconnecting')
    } catch {
      // Ignore errors while replacing the bot instance.
    }
    bot = null
  }

  spawnHandled = false
  connected = false

  const options = buildBotOptions()
  console.log(`[BOOT] connecting to ${config.host}:${config.port} version=${config.version} auth=${config.auth}${reason ? ` (${reason})` : ''}`)
  if (config.auth === 'microsoft' && !config.username) {
    console.log('[BOOT] MC_USERNAME is empty. Set your Microsoft account email in .env')
  }

  bot = mineflayer.createBot(options)

  bot.on('login', () => {
    console.log(`[LOGIN] username=${bot.username} uuid=${bot.player?.uuid || 'unknown'}`)
  })

  bot.on('spawn', () => {
    if (spawnHandled) return
    spawnHandled = true
    connected = true
    console.log('[SPAWN] connected and spawned')
    setTimeout(() => {
      for (const cmd of config.startCommands) {
        send(cmd)
      }
    }, 1500)
  })

  bot.on('message', (jsonMsg) => {
    try {
      const rendered = jsonMsg.toAnsi()
      console.log(`[CHAT] ${rendered}`)
    } catch {
      console.log(`[CHAT] ${jsonMsg.toString()}`)
    }
  })

  bot.on('kicked', (kickReason) => {
    console.log('[KICKED]', kickReason)
  })

  bot.on('error', (err) => {
    console.log('[ERROR]', err?.message || err)
  })

  bot.on('end', (endReason) => {
    connected = false
    console.log('[END]', endReason || 'connection ended')
    bot = null
    if (!shuttingDown) {
      scheduleReconnect(endReason)
    }
  })
}

function send(input) {
  const line = String(input || '').trim()
  if (!line) return { ok: false, message: 'empty command' }

  if (line === ':quit') {
    console.log('[CTRL] quitting')
    shuttingDown = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (bot) bot.quit('operator quit')
    return { ok: true, message: 'quitting bot' }
  }

  if (line === ':reconnect') {
    console.log('[CTRL] manual reconnect requested')
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    connect('manual reconnect')
    return { ok: true, message: 'reconnect triggered' }
  }

  if (!bot || !connected) {
    return { ok: false, message: 'bot is not connected' }
  }

  if (line === ':where') {
    bot.chat('/proxyops where')
    return { ok: true, message: 'sent /proxyops where' }
  }

  if (line === ':servers') {
    bot.chat('/server')
    return { ok: true, message: 'sent /server' }
  }

  const command = line.startsWith('/') ? line : `/${line}`
  bot.chat(command)
  return { ok: true, message: `sent ${command}` }
}

function writeJson(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

function isAuthorized(req) {
  if (!config.controlToken) return true
  const authHeader = req.headers.authorization || ''
  return authHeader === `Bearer ${config.controlToken}`
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 100_000) {
        reject(new Error('request body too large'))
      }
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function startControlServer() {
  if (!config.controlEnabled) {
    console.log('[CTRL] control API disabled (MC_CONTROL_ENABLED=false)')
    return
  }

  const server = http.createServer(async (req, res) => {
    if (!isAuthorized(req)) {
      return writeJson(res, 401, { ok: false, error: 'unauthorized' })
    }

    if (req.method === 'GET' && req.url === '/status') {
      return writeJson(res, 200, {
        ok: true,
        connected,
        username: bot?.username || null,
        host: config.host,
        port: config.port,
        auth: config.auth,
        reconnectPending: Boolean(reconnectTimer),
      })
    }

    if (req.method === 'POST' && req.url === '/command') {
      try {
        const raw = await parseBody(req)
        let command = raw
        if (raw && raw.trim().startsWith('{')) {
          const parsed = JSON.parse(raw)
          command = parsed.command || ''
        }
        const result = send(command)
        return writeJson(res, result.ok ? 200 : 400, result)
      } catch (err) {
        return writeJson(res, 400, { ok: false, error: err.message })
      }
    }

    if (req.method === 'POST' && req.url === '/reconnect') {
      const result = send(':reconnect')
      return writeJson(res, result.ok ? 200 : 400, result)
    }

    if (req.method === 'POST' && req.url === '/quit') {
      const result = send(':quit')
      return writeJson(res, result.ok ? 200 : 400, result)
    }

    return writeJson(res, 404, { ok: false, error: 'not found' })
  })

  server.listen(config.controlPort, config.controlHost, () => {
    console.log(`[CTRL] control API listening on http://${config.controlHost}:${config.controlPort}`)
  })
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
console.log('[CTRL] interactive ready. Use /server, /server <name>, :where, :servers, :reconnect, :quit')
rl.on('line', (line) => {
  const result = send(line)
  if (!result.ok) console.log(`[CTRL] ${result.message}`)
})

process.on('SIGINT', () => {
  console.log('\n[CTRL] SIGINT')
  send(':quit')
  process.exit(0)
})

startControlServer()
connect('initial boot')
