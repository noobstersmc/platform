#!/usr/bin/env node

require('dotenv').config()
const fs = require('fs')
const http = require('http')
const path = require('path')
const readline = require('readline')
const { URL } = require('url')
const mineflayer = require('mineflayer')
const pathfinderModule = require('mineflayer-pathfinder')
const minecraftData = require('minecraft-data')
const { Vec3 } = require('vec3')

const pathfinderPlugin = pathfinderModule.pathfinder || pathfinderModule
const Movements = pathfinderModule.Movements
const goals = pathfinderModule.goals || {}

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
  autoJoinSurvival: env('MC_AUTO_JOIN_SURVIVAL', 'true') !== 'false',
  targetServerPrefix: env('MC_TARGET_SERVER_PREFIX', 'survival-'),
  autoJoinCommandTemplate: env('MC_AUTO_JOIN_COMMAND_TEMPLATE', '/server {server}'),
  controlEnabled: env('MC_CONTROL_ENABLED', 'true') !== 'false',
  controlHost: env('MC_CONTROL_HOST', '127.0.0.1'),
  controlPort: Number(env('MC_CONTROL_PORT', '30077')),
  controlToken: env('MC_CONTROL_TOKEN', ''),
  viewerEnabled: env('MC_VIEWER_ENABLED', 'true') !== 'false',
  viewerHost: env('MC_VIEWER_HOST', '127.0.0.1'),
  viewerPort: Number(env('MC_VIEWER_PORT', '30078')),
  viewerFirstPerson: env('MC_VIEWER_FIRST_PERSON', 'true') !== 'false',
  memorySize: Number(env('MC_MEMORY_SIZE', '250')),
  autonomousEnabled: env('MC_AUTONOMOUS_ENABLED', 'false') === 'true',
  autonomousTickMs: Number(env('MC_AUTONOMOUS_TICK_MS', '4000')),
  autonomousActionTimeoutMs: Number(env('MC_AUTONOMOUS_ACTION_TIMEOUT_MS', '20000')),
  autonomousMemoryWindow: Number(env('MC_AUTONOMOUS_MEMORY_WINDOW', '40')),
  autonomousGoal: env(
    'MC_AUTONOMOUS_GOAL',
    'Play Minecraft survival: stay alive, manage hunger/health, gather wood and stone, craft basic tools, secure a safe shelter before night, and make steady progression.'
  ),
  autonomousAllowedActions: env(
    'MC_AUTONOMOUS_ALLOWED_ACTIONS',
    'chat,move,stop,look,dig,break,place,equip,interact,attack,useItem,craft,inventory,observe'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  openrouterApiKey: env('OPENROUTER_API_KEY', ''),
  openrouterModel: env('OPENROUTER_MODEL', 'openai/gpt-4.1-mini'),
  openrouterBaseUrl: env('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
  openrouterSiteUrl: env('OPENROUTER_SITE_URL', ''),
  openrouterAppName: env('OPENROUTER_APP_NAME', 'mc-bot'),
  openrouterTemperature: Number(env('OPENROUTER_TEMPERATURE', '0.2')),
  openrouterMaxTokens: Number(env('OPENROUTER_MAX_TOKENS', '300')),
  autonomousVerboseLogs: env('MC_AUTONOMOUS_VERBOSE_LOGS', 'true') !== 'false',
  autonomousAllowDestructive: env('MC_AUTONOMOUS_ALLOW_DESTRUCTIVE', 'false') === 'true',
  autonomousChatCooldownMs: Number(env('MC_AUTONOMOUS_CHAT_COOLDOWN_MS', '20000')),
  autonomousSelfReportMs: Number(env('MC_AUTONOMOUS_SELF_REPORT_MS', '45000')),
  autonomousReflectionEnabled: env('MC_AUTONOMOUS_REFLECTION_ENABLED', 'true') !== 'false',
  autonomousReflectionIntervalMs: Number(env('MC_AUTONOMOUS_REFLECTION_INTERVAL_MS', '10000')),
  autonomousReflectionMaxTokens: Number(env('MC_AUTONOMOUS_REFLECTION_MAX_TOKENS', '220')),
  chatControlEnabled: env('MC_CHAT_CONTROL_ENABLED', 'true') !== 'false',
  chatControlPrefix: env('MC_CHAT_CONTROL_PREFIX', '!'),
  chatControlAdmins: env('MC_CHAT_CONTROL_ADMINS', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  chatDirectiveEnabled: env('MC_CHAT_DIRECTIVE_ENABLED', 'true') !== 'false',
  chatDirectiveTtlMs: Number(env('MC_CHAT_DIRECTIVE_TTL_MS', '60000')),
  stateFile: env('MC_STATE_FILE', '.bot-state.json'),
  stateSaveDebounceMs: Number(env('MC_STATE_SAVE_DEBOUNCE_MS', '400')),
  stateRestoreGoal: env('MC_STATE_RESTORE_GOAL', 'false') === 'true',
  autonomousContinuousMoveEnabled: env('MC_AUTONOMOUS_CONTINUOUS_MOVE_ENABLED', 'false') !== 'false',
  autonomousContinuousMoveTickMs: Number(env('MC_AUTONOMOUS_CONTINUOUS_MOVE_TICK_MS', '1500')),
  autonomousMoveRadiusMin: Number(env('MC_AUTONOMOUS_MOVE_RADIUS_MIN', '6')),
  autonomousMoveRadiusMax: Number(env('MC_AUTONOMOUS_MOVE_RADIUS_MAX', '18')),
  autonomousObjectiveLockMs: Number(env('MC_AUTONOMOUS_OBJECTIVE_LOCK_MS', '120000')),
  autonomousObjectiveRetryLimit: Number(env('MC_AUTONOMOUS_OBJECTIVE_RETRY_LIMIT', '10')),
  autonomousAvoidHoles: env('MC_AUTONOMOUS_AVOID_HOLES', 'true') !== 'false',
  autonomousCombatTickMs: Number(env('MC_AUTONOMOUS_COMBAT_TICK_MS', '350')),
  autonomousGatherTickMs: Number(env('MC_AUTONOMOUS_GATHER_TICK_MS', '500')),
  autonomousLootTickMs: Number(env('MC_AUTONOMOUS_LOOT_TICK_MS', '400')),
}

const CAPABILITIES = [
  'chat',
  'move',
  'stop',
  'look',
  'dig',
  'place',
  'equip',
  'interact',
  'attack',
  'useItem',
  'craft',
  'inventory',
  'observe',
]

let bot = null
let movement = null
let reconnectTimer = null
let shuttingDown = false
let spawnHandled = false
let connected = false
let viewerStarted = false
let memory = []
const autonomy = {
  enabled: config.autonomousEnabled,
  running: false,
  inFlight: false,
  timer: null,
  iteration: 0,
  lastError: null,
  lastDecision: null,
  lastActionResult: null,
}
const planner = {
  inFlight: false,
  next: null,
  lastRequestedAt: 0,
  lastCompletedAt: 0,
  lastError: null,
}
const explicitMove = { inProgress: false }
const explorer = {
  enabled: config.autonomousContinuousMoveEnabled,
  timer: null,
  home: null,
  lastTarget: null,
}
let persistTimer = null
let runtimeGoal = config.autonomousGoal
let lastAutonomyChatAt = 0
let lastAutonomySelfReportAt = 0
const reflector = {
  enabled: config.autonomousReflectionEnabled,
  timer: null,
  inFlight: false,
  iteration: 0,
}
const decisionTracker = {
  lastSignature: null,
  repeatCount: 0,
}
const directives = {
  pending: null,
}
const blockedHarvestTargets = new Map()
const lootState = {
  targetId: null,
  updatedAt: 0,
}
const objectiveState = {
  type: null,
  createdAt: 0,
  lastUpdatedAt: 0,
  retries: 0,
  target: null,
  baselineWood: 0,
  notes: '',
}
const watchdog = {
  lastProgressAt: Date.now(),
  lastDecisionSignature: null,
  sameDecisionCount: 0,
  noProgressTicks: 0,
  blockedActions: new Map(),
  failureCounts: new Map(),
}
const placementState = {
  blockedTargets: new Map(),
}
const joinState = {
  attempted: false,
  joined: false,
  target: null,
  attemptedCommands: new Set(),
  lastFailureAt: 0,
  lastHintAt: 0,
  lastAttemptAt: 0,
  attemptCount: 0,
}
const worldState = {
  serverName: null,
}
const fallbackState = {
  target: null,
  createdAt: 0,
}

function pushMemory(type, data) {
  memory.push({ at: new Date().toISOString(), type, data })
  if (memory.length > config.memorySize) {
    memory = memory.slice(memory.length - config.memorySize)
  }
  schedulePersistState()
}

function stateFilePath() {
  return path.resolve(config.stateFile)
}

function schedulePersistState() {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    persistState()
  }, Math.max(50, config.stateSaveDebounceMs))
}

function persistState() {
  try {
    const file = stateFilePath()
    const tmp = `${file}.tmp`
    const payload = {
      savedAt: new Date().toISOString(),
      memory,
      autonomy: {
        enabled: autonomy.enabled,
        iteration: autonomy.iteration,
        lastError: autonomy.lastError,
        lastDecision: autonomy.lastDecision,
        lastActionResult: autonomy.lastActionResult,
        goal: runtimeGoal,
      },
      explorer: {
        enabled: explorer.enabled,
        home: explorer.home,
        lastTarget: explorer.lastTarget,
      },
    }
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2))
    fs.renameSync(tmp, file)
  } catch (err) {
    console.log('[STATE] persist failed', err?.message || err)
  }
}

function restoreState() {
  try {
    const file = stateFilePath()
    if (!fs.existsSync(file)) return
    const raw = fs.readFileSync(file, 'utf8')
    const state = JSON.parse(raw)

    if (Array.isArray(state.memory)) {
      memory = state.memory.slice(-config.memorySize)
    }

    if (state.autonomy && typeof state.autonomy === 'object') {
      autonomy.iteration = Number(state.autonomy.iteration) || 0
      autonomy.lastError = state.autonomy.lastError || null
      autonomy.lastDecision = state.autonomy.lastDecision || null
      autonomy.lastActionResult = state.autonomy.lastActionResult || null
      if (state.autonomy.goal && config.stateRestoreGoal) {
        runtimeGoal = String(state.autonomy.goal)
      }
      if (typeof state.autonomy.enabled === 'boolean' && !config.autonomousEnabled) {
        autonomy.enabled = state.autonomy.enabled
      }
    }

    if (state.explorer && typeof state.explorer === 'object') {
      explorer.lastTarget = state.explorer.lastTarget || null
      explorer.home = state.explorer.home || null
      if (typeof state.explorer.enabled === 'boolean' && config.autonomousContinuousMoveEnabled) {
        explorer.enabled = state.explorer.enabled
      }
    }

    console.log(`[STATE] restored from ${file}`)
    pushMemory('state_restored', { file })
  } catch (err) {
    console.log('[STATE] restore failed', err?.message || err)
  }
}

function buildBotOptions() {
  const options = {
    host: config.host,
    port: config.port,
    version: config.version,
    auth: config.auth,
    checkTimeoutInterval: 30 * 1000,
    onMsaCode: (code) => {
      console.log('[MSA] Complete device auth:', code)
      pushMemory('msa_code', { code })
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

function parseVec3(input) {
  if (!input) return null
  const x = Number(input.x)
  const y = Number(input.y)
  const z = Number(input.z)
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null
  return new Vec3(x, y, z)
}

function dist(a, b) {
  if (!a || !b) return null
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

function countItemsByName(names) {
  const set = new Set((names || []).map((n) => String(n)))
  const out = {}
  if (!bot?.inventory || typeof bot.inventory.items !== 'function') return out
  for (const item of bot.inventory.items()) {
    if (set.has(item.name)) {
      out[item.name] = (out[item.name] || 0) + (Number(item.count) || 0)
    }
  }
  return out
}

function resolveCraftItemName(rawName) {
  const input = String(rawName || '').trim().toLowerCase()
  if (!input) return ''
  if (bot?.registry?.itemsByName?.[input]) return input
  if (input === 'planks') {
    const inv = bot?.inventory?.items?.() || []
    const log = inv.find((it) => /_log$/.test(String(it.name || '')))
    if (log?.name) {
      const wood = log.name.replace(/_log$/, '')
      const specific = `${wood}_planks`
      if (bot?.registry?.itemsByName?.[specific]) return specific
    }
  }
  return input
}

function buildCraftingContext() {
  if (!bot || !connected) return null
  const nearbyTable = typeof bot.findBlock === 'function'
    ? bot.findBlock({ maxDistance: 6, matching: (block) => block?.name === 'crafting_table' })
    : null
  const hasTableInInventory = countInventoryMatching((it) => it?.name === 'crafting_table') > 0
  const keyTargets = [
    'acacia_planks',
    'oak_planks',
    'birch_planks',
    'spruce_planks',
    'jungle_planks',
    'dark_oak_planks',
    'mangrove_planks',
    'cherry_planks',
    'crafting_table',
    'stick',
    'wooden_pickaxe',
    'wooden_axe',
    'wooden_sword',
  ]

  const noTable = []
  const withTable = []
  for (const name of keyTargets) {
    const item = bot.registry?.itemsByName?.[name]
    if (!item) continue
    const recipesNoTable = bot.recipesFor(item.id, null, 1, null) || []
    if (recipesNoTable.length > 0) noTable.push(name)
    if (nearbyTable) {
      const recipesWithTable = bot.recipesFor(item.id, null, 1, nearbyTable) || []
      if (recipesWithTable.length > 0) withTable.push(name)
    }
  }

  return {
    hasCraftingTableInInventory: hasTableInInventory,
    nearbyCraftingTable: nearbyTable
      ? { x: nearbyTable.position.x, y: nearbyTable.position.y, z: nearbyTable.position.z }
      : null,
    craftableNowNoTable: noTable,
    craftableNowWithNearbyTable: withTable,
    keyMaterialCounts: countItemsByName([
      'acacia_log',
      'oak_log',
      'birch_log',
      'spruce_log',
      'jungle_log',
      'dark_oak_log',
      'mangrove_log',
      'cherry_log',
      'acacia_planks',
      'oak_planks',
      'birch_planks',
      'spruce_planks',
      'jungle_planks',
      'dark_oak_planks',
      'mangrove_planks',
      'cherry_planks',
      'stick',
      'crafting_table',
      'cobblestone',
      'coal',
      'porkchop',
      'cooked_porkchop',
    ]),
  }
}

function buildObservation() {
  if (!bot || !connected || !bot.entity) {
    return { connected: false }
  }

  const cursorBlock = typeof bot.blockAtCursor === 'function' ? bot.blockAtCursor(6) : null
  const entities = Object.values(bot.entities || {})
    .filter((e) => e && e.position)
    .map((e) => ({
      id: e.id,
      type: e.type,
      name: e.name || e.username || 'unknown',
      distance: Number(dist(bot.entity.position, e.position)?.toFixed(2) || 0),
      position: { x: e.position.x, y: e.position.y, z: e.position.z },
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 20)

  const inventoryItems = bot.inventory?.items?.() || []

  return {
    connected: true,
    username: bot.username,
    health: bot.health,
    food: bot.food,
    oxygenLevel: bot.oxygenLevel,
    game: {
      dimension: bot.game?.dimension || null,
      difficulty: bot.game?.difficulty || null,
    },
    position: {
      x: Number(bot.entity.position.x.toFixed(3)),
      y: Number(bot.entity.position.y.toFixed(3)),
      z: Number(bot.entity.position.z.toFixed(3)),
      yaw: Number(bot.entity.yaw.toFixed(4)),
      pitch: Number(bot.entity.pitch.toFixed(4)),
      onGround: bot.entity.onGround,
    },
    heldItem: bot.heldItem
      ? {
          name: bot.heldItem.name,
          count: bot.heldItem.count,
          slot: bot.heldItem.slot,
        }
      : null,
    lookingAtBlock: cursorBlock
      ? {
          name: cursorBlock.name,
          position: {
            x: cursorBlock.position.x,
            y: cursorBlock.position.y,
            z: cursorBlock.position.z,
          },
        }
      : null,
    inventory: inventoryItems.map((item) => ({
      name: item.name,
      count: item.count,
      slot: item.slot,
    })),
    crafting: buildCraftingContext(),
    nearbyEntities: entities,
    viewerUrl: config.viewerEnabled ? `http://${config.viewerHost}:${config.viewerPort}` : null,
  }
}

function getRecentMemory(limit) {
  const bounded = Math.max(1, Math.min(config.memorySize, Number(limit) || 50))
  return memory.slice(-bounded)
}

function autoLog(message, payload) {
  if (!config.autonomousVerboseLogs) return
  if (payload === undefined) {
    console.log(`[AUTO] ${message}`)
    return
  }
  try {
    console.log(`[AUTO] ${message}`, JSON.stringify(payload))
  } catch {
    console.log(`[AUTO] ${message}`)
  }
}

function stripAnsi(text) {
  return String(text || '').replace(/\u001b\[[0-9;]*m/g, '')
}

function sanitizeServerToken(token) {
  const clean = String(token || '')
    .replace(/§[0-9A-FK-ORa-fk-or]/g, '')
    .replace(/[^\w.-]/g, ' ')
    .trim()
  const match = clean.match(/[A-Za-z0-9][A-Za-z0-9._-]*/)
  return match ? match[0] : ''
}

function maybeJoinSurvivalFromServerList(messageText) {
  if (!bot || !connected || !config.autoJoinSurvival) return
  if (joinState.joined || joinState.attempted) return
  const plain = stripAnsi(messageText)
  const marker = 'Available servers:'
  const idx = plain.indexOf(marker)
  if (idx === -1) return
  const listText = plain.slice(idx + marker.length)
  const servers = listText
    .split(',')
    .map((s) => sanitizeServerToken(s))
    .filter(Boolean)
  const target = servers.find((s) => s.startsWith(config.targetServerPrefix))
  if (!target) return

  joinState.attempted = true
  joinState.target = target
  joinState.attemptedCommands.clear()
  joinState.attemptCount = 0
  joinState.lastAttemptAt = 0
  const primaryCmd = config.autoJoinCommandTemplate.replace(/\{server\}/g, target).trim()
  const primaryNormalized = primaryCmd.startsWith('/') ? primaryCmd : `/${primaryCmd}`
  joinState.attemptedCommands.add(primaryNormalized)
  bot.chat(primaryNormalized)
  joinState.lastAttemptAt = Date.now()
  joinState.attemptCount += 1
  pushMemory('auto_join_server', { target, source: 'server_list', command: primaryNormalized, attempt: joinState.attemptCount })
  autoLog('auto-join survival', { target, command: primaryNormalized, attempt: joinState.attemptCount })
}

function updateServerContextFromMessage(messageText) {
  const plain = stripAnsi(messageText)
  const match = plain.match(/connected to\s+([A-Za-z0-9._-]+)/i)
  if (!match) return
  worldState.serverName = match[1]
  pushMemory('server_context', {
    serverName: worldState.serverName,
  })
}

function isLobbyServerContext() {
  const name = String(worldState.serverName || '').toLowerCase()
  return name.startsWith('lobby-') || name === 'lobby'
}

function tryAutoJoinTarget(reason = 'retry') {
  if (!bot || !connected || !joinState.target) return false
  if (joinState.joined) return false
  const now = Date.now()
  if (now - joinState.lastAttemptAt < 7000) return false
  const cmdRaw = config.autoJoinCommandTemplate.replace(/\{server\}/g, joinState.target).trim()
  const command = cmdRaw.startsWith('/') ? cmdRaw : `/${cmdRaw}`
  bot.chat(command)
  joinState.lastAttemptAt = now
  joinState.attemptCount += 1
  pushMemory('auto_join_server_retry', {
    target: joinState.target,
    command,
    attempt: joinState.attemptCount,
    reason,
  })
  autoLog('auto-join retry', {
    target: joinState.target,
    command,
    attempt: joinState.attemptCount,
    reason,
  })
  return true
}

function findClosestHostile(observation) {
  if (!observation?.nearbyEntities) return null
  const hostiles = observation.nearbyEntities.filter((e) =>
    ['hostile'].includes(e.type) ||
    ['zombie', 'skeleton', 'creeper', 'spider', 'drowned', 'enderman'].includes(String(e.name || '').toLowerCase())
  )
  if (hostiles.length === 0) return null
  return hostiles.sort((a, b) => a.distance - b.distance)[0]
}

function findClosestEntityByNames(observation, names) {
  if (!observation?.nearbyEntities) return null
  const set = new Set(names.map((n) => String(n).toLowerCase()))
  const matches = observation.nearbyEntities.filter((e) => set.has(String(e.name || '').toLowerCase()))
  if (matches.length === 0) return null
  return matches.sort((a, b) => a.distance - b.distance)[0]
}

function buildPriorityState(observation) {
  const hostile = findClosestHostile(observation)
  const pig = findClosestEntityByNames(observation, ['pig'])
  return {
    health: observation?.health ?? null,
    food: observation?.food ?? null,
    nearestHostile: hostile
      ? { name: hostile.name, distance: hostile.distance }
      : null,
    nearestPig: pig
      ? { distance: pig.distance, position: pig.position }
      : null,
    hints: [
      observation?.health !== undefined && observation.health <= 10
        ? 'Health is low; prioritize safety and avoiding fights.'
        : null,
      observation?.food !== undefined && observation.food <= 8
        ? 'Hunger is low; prioritize obtaining food.'
        : null,
      hostile && hostile.distance < 16
        ? 'Hostile mob is close; create distance and avoid combat.'
        : null,
    ].filter(Boolean),
  }
}

function buildSelfReport(decision, observation) {
  const pos = observation?.position
    ? `x=${observation.position.x.toFixed(1)} y=${observation.position.y.toFixed(1)} z=${observation.position.z.toFixed(1)}`
    : 'unknown'
  const hp = observation?.health ?? '?'
  const food = observation?.food ?? '?'
  const action = decision?.action || 'none'
  return `Status hp=${hp} hunger=${food} pos=${pos}. Goal: ${runtimeGoal}. Next: ${action}.`
}

const MAX_CHAT_CHARS = 220

function splitChatMessage(message, maxLen = MAX_CHAT_CHARS) {
  const text = String(message || '').trim()
  if (!text) return []
  if (text.length <= maxLen) return [text]

  const parts = []
  let remaining = text
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf(' ', maxLen)
    if (cut < Math.floor(maxLen * 0.5)) {
      cut = maxLen
    }
    parts.push(remaining.slice(0, cut).trim())
    remaining = remaining.slice(cut).trim()
  }
  if (remaining) parts.push(remaining)
  return parts
}

function sayChat(message) {
  if (!bot) return
  const parts = splitChatMessage(message)
  for (const [index, part] of parts.entries()) {
    setTimeout(() => {
      if (!bot) return
      bot.chat(part)
      pushMemory('chat_send', { command: part, rawChat: true, chunked: parts.length > 1 })
    }, index * 250)
  }
}

function extractTargetVec(payload) {
  return parseVec3(payload) || parseVec3(payload?.position) || parseVec3(payload?.target)
}

function distanceToPosition(pos) {
  if (!bot?.entity?.position || !pos) return Infinity
  return Number(dist(bot.entity.position, pos) || Infinity)
}

function canSeeBlockLikePlayer(block, maxCursorDistance = 5) {
  if (!bot || !block) return false
  try {
    if (typeof bot.canSeeBlock === 'function') return bot.canSeeBlock(block)
  } catch {
    // Fall back below.
  }
  try {
    const cursor = typeof bot.blockAtCursor === 'function' ? bot.blockAtCursor(maxCursorDistance) : null
    if (!cursor?.position || !block.position) return false
    return cursor.position.x === block.position.x && cursor.position.y === block.position.y && cursor.position.z === block.position.z
  } catch {
    return false
  }
}

function canSeeEntityLikePlayer(entity) {
  if (!bot || !entity) return false
  try {
    if (typeof bot.canSeeEntity === 'function') return bot.canSeeEntity(entity)
  } catch {
    // Fall back below.
  }
  return true
}

function isBlockReachableLikePlayer(block, maxDistance = 4.6) {
  if (!block?.position) return false
  if (distanceToPosition(block.position) > maxDistance) return false
  return canSeeBlockLikePlayer(block, Math.ceil(maxDistance))
}

function isUnsafeHoleDig(block) {
  if (!config.autonomousAvoidHoles) return false
  if (!bot?.entity?.position || !block?.position) return false
  if (isWoodBlock(block.name)) return false

  const feetY = Math.floor(bot.entity.position.y)
  const by = block.position.y
  const dx = block.position.x - bot.entity.position.x
  const dz = block.position.z - bot.entity.position.z
  const horiz = Math.sqrt(dx * dx + dz * dz)

  // Avoid digging floor/support around our feet which traps the bot in pits.
  if (horiz <= 1.35 && by <= feetY) return true
  // Avoid digging directly below feet even with slight coord jitter.
  if (horiz <= 0.8 && by <= feetY + 1) return true
  return false
}

function isSafeHarvestBlock(blockName) {
  const name = String(blockName || '')
  return /_log$/.test(name) || name === 'melon' || name === 'pumpkin'
}

function findNearbyHarvestBlock(maxDistance = 6) {
  if (!bot || typeof bot.findBlock !== 'function') return null
  try {
    return bot.findBlock({
      maxDistance,
      matching: (block) => isSafeHarvestBlock(block?.name),
    })
  } catch {
    return null
  }
}

function isWoodBlock(blockName) {
  return /_log$/.test(String(blockName || ''))
}

function findNearestWoodBlock(maxDistance = 24) {
  if (!bot || typeof bot.findBlock !== 'function') return null
  try {
    return bot.findBlock({
      maxDistance,
      matching: (block) => isWoodBlock(block?.name),
    })
  } catch {
    return null
  }
}

function countInventoryMatching(test) {
  if (!bot?.inventory || typeof bot.inventory.items !== 'function') return 0
  return bot.inventory.items().reduce((sum, item) => (test(item) ? sum + (Number(item.count) || 0) : sum), 0)
}

function countWoodUnits() {
  return countInventoryMatching((item) => isWoodBlock(item?.name) || /_planks$/.test(String(item?.name || '')))
}

function blockKeyFromPos(pos) {
  if (!pos) return null
  const x = Number(pos.x)
  const y = Number(pos.y)
  const z = Number(pos.z)
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null
  return `${Math.floor(x)}:${Math.floor(y)}:${Math.floor(z)}`
}

function isHarvestTargetBlocked(pos) {
  const key = blockKeyFromPos(pos)
  if (!key) return false
  const until = blockedHarvestTargets.get(key)
  if (!until) return false
  if (until <= Date.now()) {
    blockedHarvestTargets.delete(key)
    return false
  }
  return true
}

function blockHarvestTarget(pos, cooldownMs = 45000) {
  const key = blockKeyFromPos(pos)
  if (!key) return
  blockedHarvestTargets.set(key, Date.now() + cooldownMs)
}

function findNearestEntityByNames(names, maxDistance = 24) {
  if (!bot?.entity || !bot.entities) return null
  const set = new Set(names.map((n) => String(n).toLowerCase()))
  const matches = Object.values(bot.entities)
    .filter((e) => e && e.position && set.has(String(e.name || '').toLowerCase()))
    .map((e) => ({
      id: e.id,
      name: e.name || e.username || 'unknown',
      distance: Number(dist(bot.entity.position, e.position)?.toFixed(2) || 0),
      position: { x: e.position.x, y: e.position.y, z: e.position.z },
    }))
    .filter((e) => e.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
  return matches[0] || null
}

function itemNameFromEntity(entity) {
  if (!entity) return null
  const md = Array.isArray(entity.metadata) ? entity.metadata : []
  const stack = md.find((v) => v && typeof v === 'object' && (v.itemId !== undefined || v.blockId !== undefined || v.type !== undefined))
  const id = Number(stack?.itemId ?? stack?.blockId ?? stack?.type)
  if (Number.isFinite(id)) {
    const byId = bot?.registry?.items?.[id]
    if (byId?.name) return byId.name
  }
  return entity.displayName || entity.name || null
}

function isUsefulItemName(name) {
  const n = String(name || '').toLowerCase()
  if (!n) return true
  if (/dirt|cobweb|tripwire_hook/.test(n)) return false
  return /(log|planks|stick|sapling|porkchop|beef|chicken|mutton|rabbit|cod|salmon|apple|bread|carrot|potato|wheat|seeds|coal|stone|cobblestone|iron|axe|pickaxe|sword|crafting_table)/.test(n)
}

function findNearbyUsefulDrop(maxDistance = 10) {
  if (!bot?.entity || !bot?.entities) return null
  const drops = Object.values(bot.entities)
    .filter((e) => e && e.position && (e.type === 'object' || String(e.name || '').toLowerCase() === 'item'))
    .map((e) => {
      const name = itemNameFromEntity(e)
      return {
        id: e.id,
        name,
        distance: Number(dist(bot.entity.position, e.position)?.toFixed(2) || 0),
        position: { x: e.position.x, y: e.position.y, z: e.position.z },
      }
    })
    .filter((e) => e.distance <= maxDistance && isUsefulItemName(e.name))
    .sort((a, b) => a.distance - b.distance)
  return drops[0] || null
}

function isEdibleItemName(name) {
  const n = String(name || '').toLowerCase()
  return /(porkchop|beef|chicken|mutton|rabbit|cod|salmon|potato|carrot|bread|apple|melon_slice|sweet_berries|dried_kelp|cooked_)/.test(n)
}

function findBestEdibleInventoryItem() {
  if (!bot?.inventory || typeof bot.inventory.items !== 'function') return null
  const items = bot.inventory.items().filter((it) => isEdibleItemName(it?.name))
  if (items.length === 0) return null
  const cooked = items.find((it) => String(it.name || '').startsWith('cooked_'))
  return cooked || items[0]
}

function inventoryCountByName(itemName) {
  if (!itemName || !bot?.inventory || typeof bot.inventory.items !== 'function') return 0
  return bot.inventory
    .items()
    .reduce((sum, it) => (it?.name === itemName ? sum + (Number(it.count) || 0) : sum), 0)
}

function countEdibleInventoryItems() {
  if (!bot?.inventory || typeof bot.inventory.items !== 'function') return 0
  return bot.inventory.items().reduce((sum, it) => (isEdibleItemName(it?.name) ? sum + (Number(it.count) || 0) : sum), 0)
}

function missingBasicWoodenTools() {
  const tools = ['wooden_pickaxe', 'wooden_axe', 'wooden_shovel', 'wooden_sword']
  return tools.filter((tool) => countInventoryMatching((it) => it?.name === tool) <= 0)
}

function hasBasicWoodenTools() {
  return missingBasicWoodenTools().length === 0
}

function preferredToolKindForBlock(blockName) {
  const name = String(blockName || '')
  if (!name) return null
  if (/(stone|cobblestone|ore|deepslate|obsidian|netherrack|bricks?|concrete|terracotta|sandstone|quartz)/.test(name)) return 'pickaxe'
  if (/(dirt|grass_block|sand|gravel|clay|snow|mud|farmland|soul_sand|soul_soil)/.test(name)) return 'shovel'
  if (/_log$|_wood$|planks|crafting_table|chest|bookshelf|bamboo_block/.test(name)) return 'axe'
  return null
}

function findBestToolForBlock(blockName) {
  const invItems = bot?.inventory?.items?.() || []
  if (invItems.length === 0) return null
  const kind = preferredToolKindForBlock(blockName)
  if (!kind) return null
  const preference = {
    pickaxe: ['diamond_pickaxe', 'netherite_pickaxe', 'iron_pickaxe', 'stone_pickaxe', 'golden_pickaxe', 'wooden_pickaxe'],
    shovel: ['diamond_shovel', 'netherite_shovel', 'iron_shovel', 'stone_shovel', 'golden_shovel', 'wooden_shovel'],
    axe: ['diamond_axe', 'netherite_axe', 'iron_axe', 'stone_axe', 'golden_axe', 'wooden_axe'],
  }[kind] || []
  for (const name of preference) {
    const tool = invItems.find((it) => it?.name === name)
    if (tool) return tool
  }
  return invItems.find((it) => it?.name?.includes(`_${kind}`)) || null
}

function chooseDeterministicObjective(observation) {
  if (isLobbyServerContext()) return null
  const hunger = observation?.food ?? 20
  const edible = findBestEdibleInventoryItem()
  if (hunger <= 17 && edible) return { type: 'eat_food', notes: `eat ${edible.name}` }
  const crafting = observation?.crafting
  const hasTableInInventory = Boolean(crafting?.hasCraftingTableInInventory)
  const hasNearbyTable = Boolean(crafting?.nearbyCraftingTable)
  const holdingTable = bot?.heldItem?.name === 'crafting_table'
  const planksCount = countInventoryMatching((it) => /_planks$/.test(String(it?.name || '')))
  const stickCount = countInventoryMatching((it) => it?.name === 'stick')
  const missingTools = missingBasicWoodenTools()
  const hasAnyToolGap = missingTools.length > 0
  if (!hasNearbyTable && (holdingTable || hasTableInInventory)) {
    return { type: 'setup_crafting', notes: 'place crafting table nearby' }
  }
  if (hasAnyToolGap && (hasTableInInventory || hasNearbyTable) && planksCount >= 3 && stickCount >= 2) {
    return { type: 'setup_crafting', notes: `craft missing wooden tools: ${missingTools.join(', ')}` }
  }
  if (hunger <= 8) return { type: 'hunt_food', notes: 'low hunger' }
  if (countWoodUnits() < 4) return { type: 'gather_wood', notes: 'low wood inventory' }
  return null
}

function chooseNextTickDelay() {
  const now = Date.now()
  if (planner.inFlight) {
    return 650
  }
  if (bot?.pathfinder && typeof bot.pathfinder.isMoving === 'function' && bot.pathfinder.isMoving()) {
    return 350
  }
  if (lootState.targetId && now - lootState.updatedAt < 4000) {
    return Math.max(250, config.autonomousLootTickMs)
  }
  if (objectiveState.type === 'hunt_food') {
    return Math.max(250, config.autonomousCombatTickMs)
  }
  if (objectiveState.type === 'gather_wood') {
    return Math.max(250, config.autonomousGatherTickMs)
  }
  if (objectiveState.type === 'eat_food') {
    return Math.max(250, config.autonomousLootTickMs)
  }
  return Math.max(350, Math.min(config.autonomousTickMs, 1200))
}

function isActionBlocked(action) {
  const until = watchdog.blockedActions.get(action)
  if (!until) return false
  if (until <= Date.now()) {
    watchdog.blockedActions.delete(action)
    return false
  }
  return true
}

function blockActionTemporarily(action, ms, reason) {
  const until = Date.now() + Math.max(3000, ms)
  watchdog.blockedActions.set(action, until)
  autoLog('action blocked temporarily', { action, ms, reason })
}

function recordFailure(action, error) {
  const key = `${action}:${String(error || 'unknown').slice(0, 80)}`
  const count = (watchdog.failureCounts.get(key) || 0) + 1
  watchdog.failureCounts.set(key, count)
  if (count >= 3) {
    blockActionTemporarily(action, 45000, key)
    watchdog.failureCounts.set(key, 0)
  }
  if (String(error || '').includes('windowOpen did not fire')) {
    blockActionTemporarily('craft', 60000, 'craft window timeout')
  }
}

function recordProgress(action, beforeObservation, afterObservation, result) {
  let progressed = false
  if (result?.ok === true) {
    if (['dig', 'break', 'craft', 'place', 'attack', 'useItem', 'equip'].includes(action)) {
      progressed = true
    }
    if (action === 'move') {
      const pre = beforeObservation?.position
      const post = afterObservation?.position
      if (pre && post) {
        const moved = Math.sqrt((pre.x - post.x) ** 2 + (pre.y - post.y) ** 2 + (pre.z - post.z) ** 2)
        progressed = moved >= 0.2
      }
    }
  }
  if (progressed) {
    watchdog.lastProgressAt = Date.now()
    watchdog.noProgressTicks = 0
    return true
  }
  watchdog.noProgressTicks += 1
  return false
}

function shouldForceRecovery() {
  const staleMs = Date.now() - watchdog.lastProgressAt
  return staleMs > 45000 || watchdog.noProgressTicks >= 40
}

function placementKey(pos) {
  if (!pos) return null
  const x = Number(pos.x)
  const y = Number(pos.y)
  const z = Number(pos.z)
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null
  return `${Math.floor(x)}:${Math.floor(y)}:${Math.floor(z)}`
}

function isPlacementBlocked(pos) {
  const key = placementKey(pos)
  if (!key) return false
  const until = placementState.blockedTargets.get(key)
  if (!until) return false
  if (until <= Date.now()) {
    placementState.blockedTargets.delete(key)
    return false
  }
  return true
}

function blockPlacementTarget(pos, ttlMs = 60000) {
  const key = placementKey(pos)
  if (!key) return
  placementState.blockedTargets.set(key, Date.now() + Math.max(5000, ttlMs))
}

function clearObjective(reason) {
  if (!objectiveState.type) return
  autoLog('objective cleared', {
    type: objectiveState.type,
    retries: objectiveState.retries,
    reason,
  })
  objectiveState.type = null
  objectiveState.createdAt = 0
  objectiveState.lastUpdatedAt = 0
  objectiveState.retries = 0
  objectiveState.target = null
  objectiveState.baselineWood = 0
  objectiveState.notes = ''
}

function activateObjective(type, seed = {}) {
  const now = Date.now()
  if (objectiveState.type !== type) {
    objectiveState.type = type
    objectiveState.createdAt = now
    objectiveState.retries = 0
    objectiveState.baselineWood = countWoodUnits()
  }
  objectiveState.lastUpdatedAt = now
  objectiveState.target = seed.target || objectiveState.target
  objectiveState.notes = seed.notes || objectiveState.notes
  autoLog('objective active', {
    type: objectiveState.type,
    retries: objectiveState.retries,
    target: objectiveState.target,
    notes: objectiveState.notes,
  })
}

function shouldKeepObjective() {
  if (!objectiveState.type) return false
  const age = Date.now() - objectiveState.createdAt
  if (age > Math.max(5000, config.autonomousObjectiveLockMs)) {
    clearObjective('expired')
    return false
  }
  if (objectiveState.retries >= Math.max(2, config.autonomousObjectiveRetryLimit)) {
    clearObjective('retry limit reached')
    return false
  }
  return true
}

function forcedDecisionForObjective(observation) {
  if (!observation?.connected) return null

  const nearbyDrop = findNearbyUsefulDrop(9)
  if (nearbyDrop && nearbyDrop.distance > 1.1) {
    lootState.targetId = nearbyDrop.id
    lootState.updatedAt = Date.now()
    return {
      action: 'move',
      payload: { ...nearbyDrop.position, range: 1, blocking: false },
      reason: `Collecting nearby drop${nearbyDrop.name ? ` (${nearbyDrop.name})` : ''}`,
    }
  }

  const currentWood = countWoodUnits()
  if (objectiveState.type === 'gather_wood') {
    if (currentWood >= objectiveState.baselineWood + 2 || currentWood >= 6) {
      clearObjective('wood target reached')
      return null
    }

    const nearWood = findNearestWoodBlock(7)
    objectiveState.lastUpdatedAt = Date.now()
    if (nearWood && bot?.canDigBlock?.(nearWood) && isBlockReachableLikePlayer(nearWood)) {
      objectiveState.target = {
        x: nearWood.position.x,
        y: nearWood.position.y,
        z: nearWood.position.z,
      }
      return {
        action: 'dig',
        payload: objectiveState.target,
        reason: `Objective gather_wood: chopping ${nearWood.name}`,
      }
    }

    const farWood = findNearestWoodBlock(30)
    if (farWood) {
      objectiveState.target = {
        x: farWood.position.x,
        y: farWood.position.y,
        z: farWood.position.z,
      }
      return {
        action: 'move',
        payload: { ...objectiveState.target, range: 2, blocking: false },
        reason: 'Objective gather_wood: moving to nearest tree',
      }
    }

    return {
      action: 'move',
      payload: { ...(chooseExploreTarget() || observation.position), range: 2, blocking: false },
      reason: 'Objective gather_wood: scouting for trees',
    }
  }

  if (objectiveState.type === 'hunt_food') {
    const pig = findNearestEntityByNames(['pig', 'cow', 'chicken', 'sheep'], 30)
    objectiveState.lastUpdatedAt = Date.now()
    if (!pig) {
      return {
        action: 'move',
        payload: { ...(chooseExploreTarget() || observation.position), range: 2, blocking: false },
        reason: 'Objective hunt_food: scouting for animals',
      }
    }

    objectiveState.target = pig.position
    if (pig.distance <= 3.2) {
      return {
        action: 'attack',
        payload: { entityId: pig.id },
        reason: `Objective hunt_food: attacking nearby ${pig.name}`,
      }
    }
    return {
      action: 'move',
      payload: { ...pig.position, range: 1, blocking: false },
      reason: `Objective hunt_food: chasing ${pig.name}`,
    }
  }

  if (objectiveState.type === 'eat_food') {
    const hunger = observation?.food ?? 20
    if (hunger >= 18) {
      clearObjective('hunger restored')
      return null
    }
    const edible = findBestEdibleInventoryItem()
    if (!edible) {
      clearObjective('no edible item')
      return null
    }
    if (bot?.heldItem?.name === edible.name) {
      return {
        action: 'useItem',
        payload: { durationMs: 1900, offhand: false },
        reason: `Objective eat_food: eating ${edible.name}`,
      }
    }
    return {
      action: 'equip',
      payload: { itemName: edible.name, destination: 'hand' },
      reason: `Objective eat_food: equip ${edible.name}`,
    }
  }

  if (objectiveState.type === 'setup_crafting') {
    const missingTools = missingBasicWoodenTools()

    const nearbyTable = typeof bot.findBlock === 'function'
      ? bot.findBlock({ maxDistance: 5, matching: (block) => block?.name === 'crafting_table' })
      : null
    if (nearbyTable) {
      const reachableTable = isBlockReachableLikePlayer(nearbyTable, 4.6)
      const hasPlanks = countInventoryMatching((it) => /_planks$/.test(String(it?.name || ''))) >= 3
      const hasSticks = countInventoryMatching((it) => it?.name === 'stick') >= 2
      if (missingTools.length === 0) {
        clearObjective('basic wooden tools crafted')
        return null
      }
      if (!reachableTable) {
        return {
          action: 'move',
          payload: { x: nearbyTable.position.x, y: nearbyTable.position.y, z: nearbyTable.position.z, range: 1.6, blocking: false },
          reason: 'Objective setup_crafting: moving to reachable crafting table',
        }
      }
      if (!hasPlanks) {
        return {
          action: 'craft',
          payload: { itemName: 'planks', count: 4 },
          reason: 'Objective setup_crafting: craft planks before tools',
        }
      }
      if (!hasSticks) {
        return {
          action: 'craft',
          payload: { itemName: 'stick', count: 4 },
          reason: 'Objective setup_crafting: craft sticks before tools',
        }
      }
      const nextTool = missingTools[0]
      return {
        action: 'craft',
        payload: {
          itemName: nextTool,
          count: 1,
          table: {
            x: nearbyTable.position.x,
            y: nearbyTable.position.y,
            z: nearbyTable.position.z,
          },
        },
        reason: `Objective setup_crafting: craft ${nextTool}`,
      }
    }

    const hasTableInInventory = countInventoryMatching((it) => it?.name === 'crafting_table') > 0
    if (!hasTableInInventory) {
      clearObjective('missing crafting table')
      return null
    }

    if (bot?.heldItem?.name !== 'crafting_table') {
      return {
        action: 'equip',
        payload: { itemName: 'crafting_table', destination: 'hand' },
        reason: 'Objective setup_crafting: equip crafting_table',
      }
    }

    const base = bot?.entity?.position?.floored()
    if (base) {
      const candidates = []
      for (let dx = -3; dx <= 3; dx += 1) {
        for (let dz = -3; dz <= 3; dz += 1) {
          const refPos = base.offset(dx, -1, dz)
          const targetPos = base.offset(dx, 0, dz)
          if (isPlacementBlocked(targetPos)) continue
          const ref = bot.blockAt(refPos)
          const target = bot.blockAt(targetPos)
          if (!ref || !target) continue
          const refSolid = String(ref.name || '') !== 'air' && String(ref.name || '') !== 'water'
          const targetFree = String(target.name || '') === 'air' || String(target.name || '') === 'cave_air'
          if (!refSolid || !targetFree) continue
          if (!isBlockReachableLikePlayer(ref, 4.6)) continue
          if (distanceToPosition(targetPos) < 1.1) continue
          const d = Math.sqrt(dx * dx + dz * dz)
          candidates.push({ refPos, d })
        }
      }
      candidates.sort((a, b) => a.d - b.d)
      const best = candidates[0]
      if (best) {
        return {
          action: 'place',
          payload: {
            reference: { x: best.refPos.x, y: best.refPos.y, z: best.refPos.z },
            face: { x: 0, y: 1, z: 0 },
          },
          reason: 'Objective setup_crafting: place crafting_table on reachable ground',
        }
      }
    }

    return {
      action: 'move',
      payload: { ...(chooseExploreTarget() || observation.position), range: 2, blocking: false },
      reason: 'Objective setup_crafting: reposition for valid table placement',
    }
  }

  return null
}

function setRuntimeGoal(goal, source = 'system') {
  const trimmed = String(goal || '').trim()
  if (!trimmed) return { ok: false, message: 'goal cannot be empty' }
  runtimeGoal = trimmed
  pushMemory('goal_update', { goal: runtimeGoal, source })
  schedulePersistState()
  return { ok: true, goal: runtimeGoal }
}

function isChatController(username) {
  if (config.chatControlAdmins.length === 0) return true
  return config.chatControlAdmins.includes(username)
}

function handleChatControl(username, message) {
  if (!config.chatControlEnabled) return
  if (!message.startsWith(config.chatControlPrefix)) return
  if (!isChatController(username)) return

  const raw = message.slice(config.chatControlPrefix.length).trim()
  if (!raw) return
  const parts = raw.split(/\s+/)
  const command = (parts.shift() || '').toLowerCase()
  const rest = raw.slice(command.length).trim()

  if (command === 'help') {
    sayChat(`${username}: commands -> !goal <text>, !status, !autonomy on|off|status, !explore on|off|status, !listen`)
    return
  }

  if (command === 'goal') {
    const result = setRuntimeGoal(rest, `chat:${username}`)
    sayChat(
      result.ok
        ? `${username}: goal updated -> ${result.goal}`
        : `${username}: ${result.message}`
    )
    return
  }

  if (command === 'status') {
    sayChat(
      `${username}: autonomy=${autonomy.enabled ? 'on' : 'off'} explore=${explorer.enabled ? 'on' : 'off'} goal="${runtimeGoal}"`
    )
    return
  }

  if (command === 'listen') {
    const pending = getActiveDirective()
    sayChat(
      `${username}: listening=${config.chatDirectiveEnabled ? 'on' : 'off'} pending=${pending ? `"${pending.text}"` : 'none'}`
    )
    return
  }

  if (command === 'autonomy') {
    const arg = (parts[0] || '').toLowerCase()
    if (arg === 'on') {
      startAutonomy(`chat:${username}`)
      sayChat(`${username}: autonomy enabled`)
      return
    }
    if (arg === 'off') {
      stopAutonomy(`chat:${username}`)
      sayChat(`${username}: autonomy disabled`)
      return
    }
    sayChat(`${username}: autonomy is ${autonomy.enabled ? 'on' : 'off'}`)
    return
  }

  if (command === 'explore') {
    const arg = (parts[0] || '').toLowerCase()
    if (arg === 'on') {
      explorer.enabled = true
      scheduleExploreTick(300)
      pushMemory('explore_toggle', { enabled: true, by: `chat:${username}` })
      sayChat(`${username}: explore enabled`)
      return
    }
    if (arg === 'off') {
      explorer.enabled = false
      if (explorer.timer) clearTimeout(explorer.timer)
      explorer.timer = null
      if (bot?.pathfinder && !explicitMove.inProgress) bot.pathfinder.stop()
      pushMemory('explore_toggle', { enabled: false, by: `chat:${username}` })
      sayChat(`${username}: explore disabled`)
      return
    }
    sayChat(`${username}: explore is ${explorer.enabled ? 'on' : 'off'}`)
  }
}

function shouldTreatAsDirective(username, message) {
  if (!config.chatDirectiveEnabled) return false
  if (!isChatController(username)) return false
  const trimmed = String(message || '').trim()
  if (!trimmed) return false
  if (trimmed.startsWith(config.chatControlPrefix)) return false
  const lower = trimmed.toLowerCase()
  const botName = String(bot?.username || '').toLowerCase()
  if (botName && lower.includes(botName)) return true
  if (lower.startsWith('bot ') || lower.startsWith('bot,') || lower.startsWith('hey bot')) return true
  // Admin/controller messages are treated as directives by default.
  return true
}

function queueDirective(username, text) {
  directives.pending = {
    username,
    text: String(text || '').trim(),
    at: Date.now(),
  }
  pushMemory('directive_queued', directives.pending)
  sayChat(`[ack] ${username}, heard you. I will prioritize: "${directives.pending.text}"`)
}

function getActiveDirective() {
  if (!directives.pending) return null
  if (Date.now() - directives.pending.at > config.chatDirectiveTtlMs) {
    pushMemory('directive_expired', { ...directives.pending })
    directives.pending = null
    return null
  }
  return directives.pending
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)),
  ])
}

function extractJsonObject(text) {
  if (!text) return null
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

async function openRouterDecision(observation, recentEvents, priorityState, operatorDirective) {
  if (!config.openrouterApiKey) {
    throw new Error('OPENROUTER_API_KEY is missing')
  }

  const endpoint = `${config.openrouterBaseUrl.replace(/\/$/, '')}/chat/completions`
  const systemPrompt = [
    'You are an autonomous Minecraft bot planner.',
    `Goal: ${runtimeGoal}`,
    `Allowed actions: ${config.autonomousAllowedActions.join(', ')}`,
    'Return only valid JSON with this shape:',
    '{"action":"<allowed-action-or-none>","payload":{},"reason":"short reason"}',
    'Rules:',
    '- Prioritize survival first: avoid nearby hostiles, protect health, and maintain hunger.',
    '- Then progress survival loop: gather wood/stone, craft tools, secure shelter.',
    operatorDirective ? `- Highest priority right now: follow operator directive "${operatorDirective.text}" from ${operatorDirective.username}.` : null,
    '- Prefer safe, reversible actions.',
    '- If uncertain, use action "observe" or a short safe move.',
    '- Keep payload minimal and valid for the selected action.',
    '- Payload schema reminders:',
    '  - equip -> {"itemName":"minecraft_item_name","destination":"hand|off-hand|head|torso|legs|feet"}',
    '  - craft -> {"itemName":"minecraft_item_name","count":1,"table":{"x":0,"y":0,"z":0} (optional)}',
    '  - move -> {"x":number,"y":number,"z":number,"range":1}',
    '  - dig/break -> {"x":number,"y":number,"z":number}',
  ].filter(Boolean).join('\\n')

  const userPrompt = JSON.stringify(
    {
      observation,
      priorityState,
      operatorDirective,
      recentEvents,
    },
    null,
    2
  )

  const headers = {
    Authorization: `Bearer ${config.openrouterApiKey}`,
    'Content-Type': 'application/json',
  }
  if (config.openrouterSiteUrl) headers['HTTP-Referer'] = config.openrouterSiteUrl
  if (config.openrouterAppName) headers['X-Title'] = config.openrouterAppName

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.openrouterModel,
      temperature: config.openrouterTemperature,
      max_tokens: config.openrouterMaxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`OpenRouter HTTP ${response.status}: ${text}`)
  }

  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content || ''
  const parsed = extractJsonObject(content)
  if (!parsed) {
    throw new Error(`failed to parse model JSON: ${String(content).slice(0, 300)}`)
  }
  return parsed
}

async function callOpenRouter(messages, maxTokens) {
  if (!config.openrouterApiKey) {
    throw new Error('OPENROUTER_API_KEY is missing')
  }

  const endpoint = `${config.openrouterBaseUrl.replace(/\/$/, '')}/chat/completions`
  const headers = {
    Authorization: `Bearer ${config.openrouterApiKey}`,
    'Content-Type': 'application/json',
  }
  if (config.openrouterSiteUrl) headers['HTTP-Referer'] = config.openrouterSiteUrl
  if (config.openrouterAppName) headers['X-Title'] = config.openrouterAppName

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.openrouterModel,
      temperature: config.openrouterTemperature,
      max_tokens: maxTokens,
      messages,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`OpenRouter HTTP ${response.status}: ${text}`)
  }

  const data = await response.json()
  return data?.choices?.[0]?.message?.content || ''
}

async function openRouterReflection(observation, recentEvents, priorityState) {
  const systemPrompt = [
    'You are a Minecraft survival strategist.',
    'Produce a short reflection and optionally update the goal.',
    'Return only valid JSON with shape:',
    '{"thought":"string","nextGoal":"string","nextStep":"string"}',
    'Rules:',
    '- thought: one short sentence about current situation and intent.',
    '- nextGoal: improved/updated survival goal if needed; otherwise repeat current goal.',
    '- nextStep: immediate concrete next step.',
    '- prioritize survival: health, hunger, nearby hostiles, shelter, tools, food.',
  ].join('\\n')

  const userPrompt = JSON.stringify(
    {
      currentGoal: runtimeGoal,
      observation,
      priorityState,
      lastDecision: autonomy.lastDecision,
      lastActionResult: autonomy.lastActionResult,
      recentEvents,
    },
    null,
    2
  )

  const content = await callOpenRouter(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    config.autonomousReflectionMaxTokens
  )

  const parsed = extractJsonObject(content)
  if (!parsed) {
    throw new Error(`failed to parse reflection JSON: ${String(content).slice(0, 260)}`)
  }
  return {
    thought: String(parsed.thought || '').trim(),
    nextGoal: String(parsed.nextGoal || '').trim(),
    nextStep: String(parsed.nextStep || '').trim(),
  }
}

function normalizeAutonomousDecision(raw) {
  const action = String(raw?.action || '').trim()
  const payload = raw?.payload && typeof raw.payload === 'object' ? raw.payload : {}
  const reason = String(raw?.reason || '').trim()
  if (!action) return { ok: false, error: 'model returned empty action' }
  if (action !== 'none' && !config.autonomousAllowedActions.includes(action)) {
    return { ok: false, error: `action not allowed: ${action}` }
  }
  return { ok: true, action, payload, reason }
}

function scheduleAutonomyTick(delayMs = config.autonomousTickMs) {
  if (!autonomy.enabled || shuttingDown) return
  if (autonomy.timer) clearTimeout(autonomy.timer)
  autonomy.timer = setTimeout(() => {
    autonomy.timer = null
    runAutonomyTick().catch((err) => {
      console.log('[AUTO] tick error', err?.message || err)
    })
  }, Math.max(250, delayMs))
}

function chooseExploreTarget() {
  const base = bot?.entity?.position || explorer.home
  if (!base) return null
  const min = Math.max(2, config.autonomousMoveRadiusMin)
  const max = Math.max(min + 1, config.autonomousMoveRadiusMax)
  const dist = min + Math.random() * (max - min)
  const angle = Math.random() * Math.PI * 2
  const x = Math.round(base.x + Math.cos(angle) * dist)
  const z = Math.round(base.z + Math.sin(angle) * dist)
  const y = Math.round(base.y)
  return { x, y, z, range: 2 }
}

function chooseLocalRecoveryTarget(radius = 3) {
  const base = bot?.entity?.position
  if (!base) return null
  const angle = Math.random() * Math.PI * 2
  const dist = Math.max(1.5, Math.random() * Math.max(2, radius))
  const x = Math.round(base.x + Math.cos(angle) * dist)
  const z = Math.round(base.z + Math.sin(angle) * dist)
  const y = Math.round(base.y)
  return { x, y, z, range: 1.5, blocking: false }
}

function requestPlannerDecision(observation, priorityState, recentEvents, operatorDirective) {
  const now = Date.now()
  if (planner.inFlight) return
  if (now - planner.lastRequestedAt < 500) return
  planner.inFlight = true
  planner.lastRequestedAt = now
  const snapshotGoal = runtimeGoal

  openRouterDecision(observation, recentEvents, priorityState, operatorDirective)
    .then((rawDecision) => {
      const normalized = normalizeAutonomousDecision(rawDecision)
      if (!normalized.ok) {
        planner.lastError = normalized.error
        return
      }
      planner.next = {
        decision: normalized,
        createdAt: Date.now(),
        goal: snapshotGoal,
      }
      planner.lastError = null
      autoLog('planner queued decision', normalized)
    })
    .catch((err) => {
      planner.lastError = err?.message || String(err)
      autoLog('planner error', { error: planner.lastError })
    })
    .finally(() => {
      planner.inFlight = false
      planner.lastCompletedAt = Date.now()
    })
}

function takePlannerDecision(maxAgeMs = 12000) {
  if (!planner.next) return null
  const queued = planner.next
  planner.next = null
  if (Date.now() - queued.createdAt > maxAgeMs) return null
  return queued.decision
}

function continuousFallbackDecision(observation, priorityState) {
  if (priorityState?.nearestHostile && Number(priorityState.nearestHostile.distance) < 10) {
    const target = chooseExploreTarget()
    return {
      action: 'move',
      payload: target || { x: observation.position.x, y: observation.position.y, z: observation.position.z, range: 3 },
      reason: 'Fallback: keep retreating from nearby hostile while planner thinks',
    }
  }
  if (bot?.pathfinder && typeof bot.pathfinder.isMoving === 'function' && bot.pathfinder.isMoving()) {
    return { action: 'observe', payload: {}, reason: 'Fallback: continuing current movement while planner thinks' }
  }
  if (!objectiveState.type && Date.now() - watchdog.lastProgressAt < 8000) {
    return { action: 'observe', payload: {}, reason: 'Fallback: hold briefly while planner thinks' }
  }
  if (fallbackState.target && Date.now() - fallbackState.createdAt < 2200) {
    return {
      action: 'move',
      payload: { ...fallbackState.target, blocking: false },
      reason: 'Fallback: continue short move while planner thinks',
    }
  }
  const nextTarget = chooseLocalRecoveryTarget(2) || { x: observation.position.x, y: observation.position.y, z: observation.position.z, range: 1.5 }
  fallbackState.target = nextTarget
  fallbackState.createdAt = Date.now()
  return {
    action: 'move',
    payload: { ...nextTarget, blocking: false },
    reason: 'Fallback: keep moving while planner thinks',
  }
}

function scheduleExploreTick(delayMs = config.autonomousContinuousMoveTickMs) {
  if (!explorer.enabled || shuttingDown) return
  if (explorer.timer) clearTimeout(explorer.timer)
  explorer.timer = setTimeout(() => {
    explorer.timer = null
    runExploreTick().catch((err) => {
      console.log('[EXPLORE] tick error', err?.message || err)
    })
  }, Math.max(250, delayMs))
}

function scheduleReflectionTick(delayMs = config.autonomousReflectionIntervalMs) {
  if (!reflector.enabled || shuttingDown) return
  if (reflector.timer) clearTimeout(reflector.timer)
  reflector.timer = setTimeout(() => {
    reflector.timer = null
    runReflectionTick().catch((err) => {
      console.log('[REFLECT] tick error', err?.message || err)
    })
  }, Math.max(1000, delayMs))
}

async function runReflectionTick() {
  if (!reflector.enabled || reflector.inFlight || shuttingDown) return
  if (!autonomy.enabled || !connected || !bot) {
    scheduleReflectionTick()
    return
  }

  reflector.inFlight = true
  reflector.iteration += 1
  const startedAt = Date.now()
  try {
    const observation = buildObservation()
    const priorityState = buildPriorityState(observation)
    const recentEvents = getRecentMemory(config.autonomousMemoryWindow)

    autoLog(`reflection ${reflector.iteration} start`, { goal: runtimeGoal, priorityState })
    const reflection = await openRouterReflection(observation, recentEvents, priorityState)
    autoLog('reflection result', reflection)

    if (reflection.nextGoal) {
      const result = setRuntimeGoal(reflection.nextGoal, 'reflection')
      if (result.ok) {
        autoLog('goal updated by reflection', { goal: result.goal })
      }
    }

    if (reflection.thought) {
      const msg = `[think] ${reflection.thought} Next: ${reflection.nextStep || 'observe surroundings.'}`
      if (bot) {
        sayChat(msg)
        lastAutonomySelfReportAt = Date.now()
        lastAutonomyChatAt = Date.now()
        pushMemory('autonomy_reflection', {
          thought: reflection.thought,
          nextStep: reflection.nextStep,
          goal: runtimeGoal,
        })
      }
    }

    autoLog('reflection latency', { ms: Date.now() - startedAt })
  } catch (err) {
    pushMemory('autonomy_reflection_error', { error: err?.message || String(err) })
    console.log('[REFLECT] error', err?.message || err)
  } finally {
    reflector.inFlight = false
    if (reflector.enabled && !shuttingDown) {
      scheduleReflectionTick()
    }
  }
}

async function runExploreTick() {
  if (!explorer.enabled || shuttingDown) return
  if (!autonomy.enabled || !connected || !bot?.pathfinder || explicitMove.inProgress) {
    scheduleExploreTick()
    return
  }
  if (getActiveDirective()) {
    scheduleExploreTick()
    return
  }
  if (autonomy.inFlight) {
    scheduleExploreTick()
    return
  }

  if (typeof bot.pathfinder.isMoving === 'function' && bot.pathfinder.isMoving()) {
    scheduleExploreTick()
    return
  }

  const target = chooseExploreTarget()
  if (!target || !goals.GoalNear) {
    scheduleExploreTick()
    return
  }

  const goal = new goals.GoalNear(target.x, target.y, target.z, target.range)
  bot.pathfinder.setGoal(goal, false)
  explorer.lastTarget = target
  pushMemory('explore_goal_set', target)
  scheduleExploreTick()
}

function startAutonomy(reason = 'manual') {
  if (autonomy.enabled) {
    return { ok: true, message: 'autonomy already enabled' }
  }
  autonomy.enabled = true
  pushMemory('autonomy_start', { reason })
  console.log(`[AUTO] enabled (${reason})`)
  scheduleAutonomyTick(300)
  if (explorer.enabled) scheduleExploreTick(300)
  if (reflector.enabled) scheduleReflectionTick(800)
  schedulePersistState()
  return { ok: true, message: 'autonomy enabled' }
}

function stopAutonomy(reason = 'manual') {
  if (!autonomy.enabled) {
    return { ok: true, message: 'autonomy already disabled' }
  }
  autonomy.enabled = false
  if (autonomy.timer) {
    clearTimeout(autonomy.timer)
    autonomy.timer = null
  }
  pushMemory('autonomy_stop', { reason })
  console.log(`[AUTO] disabled (${reason})`)
  if (reflector.timer) {
    clearTimeout(reflector.timer)
    reflector.timer = null
  }
  schedulePersistState()
  return { ok: true, message: 'autonomy disabled' }
}

async function runAutonomyTick() {
  if (!autonomy.enabled || autonomy.inFlight || shuttingDown) return
  if (!bot || !connected) {
    scheduleAutonomyTick()
    return
  }

  autonomy.inFlight = true
  autonomy.iteration += 1
  const tickStartedAt = Date.now()
  try {
    autoLog(`tick ${autonomy.iteration} start`, {
      position: bot?.entity
        ? {
            x: Number(bot.entity.position.x.toFixed(2)),
            y: Number(bot.entity.position.y.toFixed(2)),
            z: Number(bot.entity.position.z.toFixed(2)),
          }
        : null,
      goal: runtimeGoal,
    })
    const observation = buildObservation()
    const priorityState = buildPriorityState(observation)
    autoLog('priority state', priorityState)
    if (isLobbyServerContext()) {
      clearObjective('in lobby awaiting survival transfer')
      tryAutoJoinTarget('lobby poll')
      const now = Date.now()
      if (now - joinState.lastHintAt > 15000) {
        joinState.lastHintAt = now
        autoLog('lobby mode', {
          server: worldState.serverName,
          joinTarget: joinState.target,
          autoJoinTemplate: config.autoJoinCommandTemplate,
          hint: 'Set MC_AUTO_JOIN_COMMAND_TEMPLATE to the correct command for your server network.',
        })
      }
      const decision = {
        ok: true,
        action: 'observe',
        payload: {},
        reason: 'In lobby; pausing survival actions until server transfer succeeds',
      }
      autonomy.lastDecision = decision
      pushMemory('autonomy_decision', {
        action: decision.action,
        reason: decision.reason,
        payload: decision.payload,
      })
      const result = await runAction(decision.action, decision.payload)
      autonomy.lastActionResult = result
      pushMemory('autonomy_action_result', {
        action: decision.action,
        ok: result.ok === true,
        result,
      })
      scheduleAutonomyTick(1500)
      return
    }
    const recentEvents = getRecentMemory(config.autonomousMemoryWindow)
    const operatorDirective = getActiveDirective()
    if (operatorDirective) {
      autoLog('active directive', operatorDirective)
    }
    const policyObjective = !operatorDirective ? chooseDeterministicObjective(observation) : null
    if (!operatorDirective && !shouldKeepObjective()) {
      if (policyObjective) {
        activateObjective(policyObjective.type, { notes: policyObjective.notes })
      }
    } else if (operatorDirective) {
      clearObjective('operator directive active')
    }

    let decision = null
    const forcedObjectiveDecision = shouldKeepObjective() ? forcedDecisionForObjective(observation) : null
    if (forcedObjectiveDecision) {
      decision = normalizeAutonomousDecision(forcedObjectiveDecision)
      fallbackState.target = null
      fallbackState.createdAt = 0
      autoLog('objective decision override', {
        objective: objectiveState.type,
        decision: forcedObjectiveDecision,
      })
    } else {
      requestPlannerDecision(observation, priorityState, recentEvents, operatorDirective)
      const queued = takePlannerDecision()
      if (queued) {
        decision = queued
        fallbackState.target = null
        fallbackState.createdAt = 0
        autoLog('planner decision consumed', queued)
      } else {
        decision = normalizeAutonomousDecision(continuousFallbackDecision(observation, priorityState))
        autoLog('planner pending fallback', {
          inFlight: planner.inFlight,
          lastError: planner.lastError,
          decision,
        })
      }
    }
    if (!decision.ok) throw new Error(decision.error)

    const decisionSignature = JSON.stringify({ action: decision.action, payload: decision.payload || {} })
    if (watchdog.lastDecisionSignature === decisionSignature) {
      watchdog.sameDecisionCount += 1
    } else {
      watchdog.lastDecisionSignature = decisionSignature
      watchdog.sameDecisionCount = 1
    }

    if (isActionBlocked(decision.action)) {
      const recoveryTarget = chooseExploreTarget()
      decision.action = 'move'
      decision.payload = recoveryTarget || { x: observation.position.x, y: observation.position.y, z: observation.position.z, range: 2 }
      decision.reason = `Recovery override: action temporarily blocked`
      autoLog('blocked action recovery override', decision)
    }

    const nearbyHarvest = findNearbyHarvestBlock(6)
    const nearbyDrop = findNearbyUsefulDrop(10)
    if (
      nearbyHarvest &&
      bot?.canDigBlock?.(nearbyHarvest) &&
      isBlockReachableLikePlayer(nearbyHarvest) &&
      !isHarvestTargetBlocked(nearbyHarvest.position) &&
      objectiveState.type !== 'hunt_food' &&
      objectiveState.type !== 'setup_crafting' &&
      (observation?.food ?? 20) > 8 &&
      ['observe', 'move', 'none'].includes(decision.action)
    ) {
      decision.action = 'dig'
      decision.payload = {
        x: nearbyHarvest.position.x,
        y: nearbyHarvest.position.y,
        z: nearbyHarvest.position.z,
      }
      decision.reason = `Direct harvest override: ${nearbyHarvest.name} is nearby`
      autoLog('harvest override', { block: nearbyHarvest.name, payload: decision.payload })
    }

    if (priorityState.nearestHostile && priorityState.nearestHostile.distance < 10) {
      decision.action = 'move'
      const target = chooseExploreTarget()
      decision.payload = target || { x: observation.position.x, y: observation.position.y, z: observation.position.z, range: 3 }
      decision.reason = `Emergency retreat from nearby hostile (${priorityState.nearestHostile.name})`
      autoLog('emergency override', decision)
    }

    const hostileTooCloseForLoot =
      Boolean(priorityState.nearestHostile) &&
      Number(priorityState.nearestHostile.distance) < 14
    const unsafeForLoot = hostileTooCloseForLoot || (observation?.health ?? 20) <= 10
    if (
      nearbyDrop &&
      nearbyDrop.distance > 1.1 &&
      !unsafeForLoot &&
      ['observe', 'move', 'none'].includes(decision.action) &&
      (!objectiveState.type || objectiveState.type !== 'hunt_food' || nearbyDrop.distance < 5)
    ) {
      lootState.targetId = nearbyDrop.id
      lootState.updatedAt = Date.now()
      decision.action = 'move'
      decision.payload = { ...nearbyDrop.position, range: 1, blocking: false }
      decision.reason = `Loot override: collecting drop${nearbyDrop.name ? ` (${nearbyDrop.name})` : ''}`
      autoLog('loot override', { drop: nearbyDrop })
    }

    const signature = JSON.stringify({
      action: decision.action,
      payload: decision.payload || {},
    })
    if (decisionTracker.lastSignature === signature) {
      decisionTracker.repeatCount += 1
    } else {
      decisionTracker.lastSignature = signature
      decisionTracker.repeatCount = 1
    }

    if (
      decisionTracker.repeatCount >= 4 &&
      ['observe', 'move'].includes(decision.action) &&
      !nearbyHarvest
    ) {
      const forceTarget = chooseExploreTarget()
      if (forceTarget) {
        decision.action = 'move'
        decision.payload = { ...forceTarget, blocking: false }
        decision.reason = `Anti-stall override after repeated ${decisionTracker.repeatCount}x decisions`
        autoLog('anti-stall override', decision)
        decisionTracker.repeatCount = 0
      }
    }

    const recoverySensitiveAction = ['dig', 'craft', 'attack', 'place'].includes(decision.action)
    const allowWatchdogRecovery = Boolean(objectiveState.type) || recoverySensitiveAction
    if ((allowWatchdogRecovery && shouldForceRecovery()) || watchdog.sameDecisionCount >= 12) {
      const stickySetupCrafting = objectiveState.type === 'setup_crafting'
      if (!stickySetupCrafting) {
        clearObjective('watchdog recovery')
      }
      const recoveryTarget = stickySetupCrafting
        ? chooseLocalRecoveryTarget(3)
        : chooseExploreTarget()
      if (recoveryTarget) {
        decision.action = 'move'
        decision.payload = {
          ...recoveryTarget,
          range: Number.isFinite(Number(recoveryTarget.range)) ? Number(recoveryTarget.range) : 2,
          blocking: false,
        }
        decision.reason = stickySetupCrafting
          ? 'Watchdog recovery: local reposition for crafting setup'
          : 'Watchdog recovery: forced reposition to break stuck loop'
        autoLog('watchdog forced recovery', {
          noProgressTicks: watchdog.noProgressTicks,
          sameDecisionCount: watchdog.sameDecisionCount,
          objective: objectiveState.type,
          target: recoveryTarget,
        })
      }
    }

    if (!config.autonomousAllowDestructive && ['dig', 'break', 'place'].includes(decision.action)) {
      let allowed = false
      if (['dig', 'break'].includes(decision.action)) {
        const target = extractTargetVec(decision.payload)
        const block = target && bot ? bot.blockAt(target) : null
        if (block && isSafeHarvestBlock(block.name)) {
          allowed = true
          autoLog('destructive action allowed (safe harvest)', {
            action: decision.action,
            block: block.name,
            target,
          })
        }
      }
      if (!allowed) {
        autoLog('destructive action blocked', { action: decision.action, reason: decision.reason })
        decision.action = 'observe'
        decision.payload = {}
        decision.reason = `Destructive action blocked: ${decision.reason || 'no reason provided'}`
      }
    }

    if (decision.action === 'chat') {
      const now = Date.now()
      if (now - lastAutonomyChatAt < config.autonomousChatCooldownMs) {
        autoLog('chat action throttled', { cooldownMs: config.autonomousChatCooldownMs })
        decision.action = 'observe'
        decision.payload = {}
        decision.reason = `Chat throttled due to cooldown (${config.autonomousChatCooldownMs}ms)`
      } else {
        lastAutonomyChatAt = now
      }
    }

    autonomy.lastDecision = decision
    pushMemory('autonomy_decision', {
      action: decision.action,
      reason: decision.reason,
      payload: decision.payload,
    })
    autoLog('decision accepted', decision)
    if (operatorDirective) {
      pushMemory('directive_applied', {
        username: operatorDirective.username,
        text: operatorDirective.text,
        action: decision.action,
      })
      directives.pending = null
    }

    if (decision.action === 'none') {
      autonomy.lastActionResult = { ok: true, skipped: true }
      autoLog('decision skipped', { reason: decision.reason || 'model returned none' })
      scheduleAutonomyTick(chooseNextTickDelay())
      return
    }

    const actionStartedAt = Date.now()
    const beforeObservation = observation
    const preFood = observation?.food ?? null
    const preEdibleCount = countEdibleInventoryItems()
    const result = await withTimeout(
      runAction(decision.action, decision.payload),
      config.autonomousActionTimeoutMs
    )
    const afterObservation = buildObservation()
    if (objectiveState.type && result?.ok === false) {
      objectiveState.retries += 1
      objectiveState.lastUpdatedAt = Date.now()
      autoLog('objective action failed', {
        objective: objectiveState.type,
        retries: objectiveState.retries,
        error: result.error || 'unknown',
      })
    } else if (objectiveState.type && result?.ok === true) {
      objectiveState.retries = Math.max(0, objectiveState.retries - 1)
      objectiveState.lastUpdatedAt = Date.now()
    }
    if (objectiveState.type === 'gather_wood') {
      const latestWood = countWoodUnits()
      if (latestWood > objectiveState.baselineWood) {
        clearObjective('wood gained')
      }
    }
    if (decision.action === 'dig' && result?.ok === false) {
      const target = extractTargetVec(decision.payload)
      if (target) {
        blockHarvestTarget(target)
        autoLog('harvest target blocked after failed dig', { target })
      }
    }
    if (decision.action === 'dig' && result?.ok === true) {
      lootState.updatedAt = Date.now()
    }
    if (decision.action === 'move' && lootState.targetId) {
      if (!bot?.entities?.[lootState.targetId]) {
        lootState.targetId = null
      } else {
        lootState.updatedAt = Date.now()
      }
    }
    if (decision.action === 'attack' && result?.ok === true) {
      lootState.updatedAt = Date.now()
    }
    if (objectiveState.type === 'hunt_food' && result?.ok === true) {
      if ((observation?.food ?? 20) >= 12) {
        clearObjective('hunger recovered')
      }
    }
    if (objectiveState.type === 'eat_food' && result?.ok === true && decision.action === 'useItem') {
      const postFood = bot?.food ?? preFood
      const postEdibleCount = countEdibleInventoryItems()
      if (
        (Number.isFinite(preFood) && Number.isFinite(postFood) && postFood > preFood) ||
        postEdibleCount < preEdibleCount
      ) {
        clearObjective('eat action completed')
      } else {
        objectiveState.retries += 1
        autoLog('eat attempt had no effect, retrying', {
          preFood,
          postFood,
          preEdibleCount,
          postEdibleCount,
          retries: objectiveState.retries,
        })
      }
    }
    if (objectiveState.type === 'setup_crafting' && hasBasicWoodenTools()) {
      clearObjective('basic wooden tools crafted')
    }
    if (result?.ok === false) {
      recordFailure(decision.action, result?.error)
      if (decision.action === 'place' && String(result?.error || '').includes('blockUpdate')) {
        const ref = parseVec3(decision.payload?.reference) || parseVec3(decision.payload)
        const face = parseVec3(decision.payload?.face) || new Vec3(0, 1, 0)
        if (ref) {
          blockPlacementTarget({ x: ref.x + face.x, y: ref.y + face.y, z: ref.z + face.z }, 90000)
        }
      }
    } else {
      watchdog.failureCounts.clear()
    }
    recordProgress(decision.action, beforeObservation, afterObservation, result)
    autonomy.lastActionResult = result
    pushMemory('autonomy_action_result', {
      action: decision.action,
      ok: result.ok === true,
      result,
    })
    autoLog('action result', {
      action: decision.action,
      ok: result.ok === true,
      error: result?.ok === false ? result?.error || 'unknown error' : undefined,
      actionMs: Date.now() - actionStartedAt,
      tickMs: Date.now() - tickStartedAt,
    })

    const now = Date.now()
    if (
      !reflector.enabled &&
      config.autonomousSelfReportMs > 0 &&
      now - lastAutonomySelfReportAt >= config.autonomousSelfReportMs
    ) {
      const report = buildSelfReport(decision, observation)
      sayChat(report)
      lastAutonomySelfReportAt = now
      pushMemory('autonomy_self_report', { report })
      autoLog('self report sent', { report })
    }
  } catch (err) {
    autonomy.lastError = err?.message || String(err)
    pushMemory('autonomy_error', { error: autonomy.lastError })
    console.log('[AUTO] error', autonomy.lastError)
    if (autonomy.lastDecision?.action) {
      recordFailure(autonomy.lastDecision.action, autonomy.lastError)
    }
    await wait(Math.max(1000, config.autonomousTickMs))
  } finally {
    autonomy.inFlight = false
    if (autonomy.enabled && !shuttingDown) {
      scheduleAutonomyTick(chooseNextTickDelay())
    }
  }
}

function scheduleReconnect(reason) {
  if (!config.autoReconnect || shuttingDown || reconnectTimer) return
  console.log(`[RECONNECT] scheduling in ${config.reconnectDelayMs}ms (${reason || 'unknown'})`)
  pushMemory('reconnect_scheduled', { reason: reason || 'unknown', delayMs: config.reconnectDelayMs })
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect('scheduled reconnect')
  }, config.reconnectDelayMs)
}

function enablePlugins() {
  if (!pathfinderPlugin || typeof pathfinderPlugin !== 'function') {
    console.log('[PATHFINDER] plugin not available, move actions will be disabled')
    pushMemory('pathfinder_error', { error: 'plugin not available' })
    return
  }

  bot.loadPlugin(pathfinderPlugin)
}

function initMovements() {
  if (!bot?.pathfinder || !Movements) {
    pushMemory('pathfinder_error', { error: 'pathfinder unavailable after spawn' })
    return
  }
  const mcData = minecraftData(bot.version)
  movement = new Movements(bot, mcData)
  bot.pathfinder.setMovements(movement)
  movement.allowSprinting = true
  pushMemory('pathfinder_ready', {})
}

function startViewerIfNeeded() {
  if (!config.viewerEnabled || viewerStarted) return
  try {
    const { mineflayer: startViewer } = require('prismarine-viewer')
    startViewer(bot, {
      host: config.viewerHost,
      port: config.viewerPort,
      firstPerson: config.viewerFirstPerson,
      viewDistance: 8,
    })
    viewerStarted = true
    console.log(`[VIEWER] live viewer at http://${config.viewerHost}:${config.viewerPort}`)
    pushMemory('viewer_started', { host: config.viewerHost, port: config.viewerPort, firstPerson: config.viewerFirstPerson })
  } catch (err) {
    console.log('[VIEWER] failed to start', err?.message || err)
    console.log('[VIEWER] bot will continue running without viewer. Set MC_VIEWER_ENABLED=false to silence this.')
    pushMemory('viewer_error', { error: err?.message || String(err), viewerDisabled: false })
  }
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

  pushMemory('connect_attempt', { reason: reason || 'unknown' })

  bot = mineflayer.createBot(options)
  enablePlugins()

  bot.on('login', () => {
    console.log(`[LOGIN] username=${bot.username} uuid=${bot.player?.uuid || 'unknown'}`)
    pushMemory('login', { username: bot.username, uuid: bot.player?.uuid || null })
  })

  bot.on('spawn', () => {
    if (spawnHandled) return
    spawnHandled = true
    connected = true
    joinState.attempted = false
    joinState.joined = false
    initMovements()
    startViewerIfNeeded()

    console.log('[SPAWN] connected and spawned')
    pushMemory('spawn', buildObservation())
    if (!explorer.home && bot?.entity?.position) {
      explorer.home = {
        x: Number(bot.entity.position.x.toFixed(2)),
        y: Number(bot.entity.position.y.toFixed(2)),
        z: Number(bot.entity.position.z.toFixed(2)),
      }
      pushMemory('explore_home_set', explorer.home)
    }
    if (autonomy.enabled) {
      scheduleAutonomyTick(500)
      if (explorer.enabled) scheduleExploreTick(800)
      if (reflector.enabled) scheduleReflectionTick(2000)
    }

    setTimeout(() => {
      for (const cmd of config.startCommands) {
        send(cmd)
      }
    }, 1500)
  })

  bot.on('message', (jsonMsg) => {
    let rendered = ''
    try {
      rendered = jsonMsg.toAnsi()
    } catch {
      rendered = jsonMsg.toString()
    }
    console.log(`[CHAT] ${rendered}`)
    pushMemory('chat', { text: rendered })
    updateServerContextFromMessage(rendered)
    maybeJoinSurvivalFromServerList(rendered)
    const plain = stripAnsi(rendered)
    if (
      joinState.attempted &&
      joinState.target &&
      /unknown or incomplete command/i.test(plain)
    ) {
      joinState.lastFailureAt = Date.now()
      tryAutoJoinTarget('command rejected')
    }
    if (/\bconnected to\b/i.test(plain) && plain.includes(config.targetServerPrefix)) {
      joinState.joined = true
      pushMemory('auto_join_server_confirmed', { text: plain })
    }
  })

  bot.on('chat', (username, message) => {
    if (!username || username === bot.username) return
    pushMemory('chat_user', { username, message })
    handleChatControl(username, message)
    if (shouldTreatAsDirective(username, message)) {
      queueDirective(username, message)
    }
  })

  bot.on('kicked', (kickReason) => {
    console.log('[KICKED]', kickReason)
    pushMemory('kicked', { reason: kickReason })
  })

  bot.on('error', (err) => {
    console.log('[ERROR]', err?.message || err)
    pushMemory('error', { error: err?.message || String(err) })
  })

  bot.on('end', (endReason) => {
    connected = false
    console.log('[END]', endReason || 'connection ended')
    pushMemory('end', { reason: endReason || 'connection ended' })
    bot = null
    explicitMove.inProgress = false
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
    stopAutonomy('quit')
    shuttingDown = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (bot) bot.quit('operator quit')
    pushMemory('quit', { reason: 'operator quit' })
    return { ok: true, message: 'quitting bot' }
  }

  if (line === ':reconnect') {
    console.log('[CTRL] manual reconnect requested')
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    pushMemory('reconnect_manual', { by: 'operator' })
    connect('manual reconnect')
    return { ok: true, message: 'reconnect triggered' }
  }

  if (line === ':autonomy on') {
    return startAutonomy('stdin')
  }

  if (line === ':autonomy off') {
    return stopAutonomy('stdin')
  }

  if (line === ':autonomy status') {
    return {
      ok: true,
      message: JSON.stringify({
        enabled: autonomy.enabled,
        inFlight: autonomy.inFlight,
        iteration: autonomy.iteration,
        goal: runtimeGoal,
        lastError: autonomy.lastError,
        lastDecision: autonomy.lastDecision,
        lastActionResult: autonomy.lastActionResult,
        explorer: {
          enabled: explorer.enabled,
          lastTarget: explorer.lastTarget,
        },
        reflector: {
          enabled: reflector.enabled,
          inFlight: reflector.inFlight,
          iteration: reflector.iteration,
          intervalMs: config.autonomousReflectionIntervalMs,
        },
        objective: {
          type: objectiveState.type,
          retries: objectiveState.retries,
          target: objectiveState.target,
          baselineWood: objectiveState.baselineWood,
          ageMs: objectiveState.createdAt ? Date.now() - objectiveState.createdAt : 0,
        },
      }),
    }
  }

  if (line === ':explore on') {
    explorer.enabled = true
    pushMemory('explore_toggle', { enabled: true, by: 'stdin' })
    scheduleExploreTick(300)
    return { ok: true, message: 'explore enabled' }
  }

  if (line === ':explore off') {
    explorer.enabled = false
    if (explorer.timer) clearTimeout(explorer.timer)
    explorer.timer = null
    if (bot?.pathfinder && !explicitMove.inProgress) bot.pathfinder.stop()
    pushMemory('explore_toggle', { enabled: false, by: 'stdin' })
    return { ok: true, message: 'explore disabled' }
  }

  if (line.startsWith(':goal ')) {
    const result = setRuntimeGoal(line.slice(6), 'stdin')
    return result.ok
      ? { ok: true, message: `goal updated -> ${result.goal}` }
      : { ok: false, message: result.message }
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

  if (line === ':status') {
    return { ok: true, message: JSON.stringify(buildObservation()) }
  }

  const command = line.startsWith('/') ? line : `/${line}`
  bot.chat(command)
  pushMemory('chat_send', { command })
  return { ok: true, message: `sent ${command}` }
}

async function runAction(action, payload = {}) {
  if (!bot || !connected) {
    return { ok: false, error: 'bot is not connected' }
  }

  const name = String(action || '').trim()
  try {
    if (name === 'chat') {
      const message = String(payload.message || payload.text || '').trim()
      if (!message) return { ok: false, error: 'message is required' }
      sayChat(message)
      return { ok: true, result: { ok: true, message: `sent chat: ${message}` } }
    }

    if (name === 'observe') {
      return { ok: true, observation: buildObservation() }
    }

    if (name === 'inventory') {
      return {
        ok: true,
        inventory: buildObservation().inventory,
        heldItem: buildObservation().heldItem,
      }
    }

    if (name === 'move') {
      if (!bot.pathfinder || !goals.GoalNear) {
        return { ok: false, error: 'pathfinder is not available in this runtime' }
      }
      if (!movement) initMovements()
      const point = parseVec3(payload)
      if (!point) return { ok: false, error: 'x,y,z are required numbers' }
      const range = Number.isFinite(Number(payload.range)) ? Number(payload.range) : 1
      const goal = new goals.GoalNear(point.x, point.y, point.z, range)
      const blocking = payload.blocking === true
      if (!blocking) {
        bot.pathfinder.setGoal(goal, false)
        pushMemory('action_move', { target: point, range, blocking: false })
        return { ok: true, movingTo: { x: point.x, y: point.y, z: point.z, range } }
      }

      explicitMove.inProgress = true
      try {
        await bot.pathfinder.goto(goal)
      } finally {
        explicitMove.inProgress = false
      }
      pushMemory('action_move', { target: point, range, blocking: true })
      return { ok: true, reached: { x: point.x, y: point.y, z: point.z, range } }
    }

    if (name === 'stop') {
      if (bot.pathfinder) bot.pathfinder.stop()
      bot.clearControlStates()
      pushMemory('action_stop', {})
      return { ok: true }
    }

    if (name === 'look') {
      const force = payload.force !== false
      const target = parseVec3(payload.target)
      if (target) {
        await bot.lookAt(target, force)
        pushMemory('action_look_at', { target })
        return { ok: true, lookedAt: target }
      }

      const yaw = Number(payload.yaw)
      const pitch = Number(payload.pitch)
      if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) {
        return { ok: false, error: 'use target{x,y,z} or yaw+pitch' }
      }
      await bot.look(yaw, pitch, force)
      pushMemory('action_look', { yaw, pitch, force })
      return { ok: true, yaw, pitch }
    }

    if (name === 'dig' || name === 'break') {
      const point = extractTargetVec(payload)
      if (!point) return { ok: false, error: 'x,y,z are required numbers' }
      const block = bot.blockAt(point)
      if (!block) return { ok: false, error: 'block not found' }
      if (!block.diggable || ['air', 'cave_air', 'void_air', 'water', 'lava'].includes(String(block.name || ''))) {
        return { ok: false, error: `target block is not diggable: ${block.name}` }
      }
      if (!isBlockReachableLikePlayer(block, 4.6)) {
        return { ok: false, error: 'block is not reachable with normal survival interaction (distance/line-of-sight)' }
      }
      if (isUnsafeHoleDig(block)) {
        return { ok: false, error: `dig blocked to avoid trapping in hole: ${block.name}` }
      }
      if (!bot.canDigBlock(block)) return { ok: false, error: `cannot dig ${block.name}` }
      const preferredTool = findBestToolForBlock(block.name)
      if (preferredTool && bot?.heldItem?.name !== preferredTool.name) {
        await bot.equip(preferredTool, 'hand')
      }
      await bot.dig(block)
      pushMemory('action_dig', { block: block.name, position: point })
      return { ok: true, block: block.name, position: point, tool: bot?.heldItem?.name || null }
    }

    if (name === 'place') {
      const explicitReference = parseVec3(payload.reference)
      const directTarget =
        !explicitReference
          ? (parseVec3(payload.position) || parseVec3(payload) || parseVec3(payload.target))
          : null

      let reference = explicitReference
      let face = parseVec3(payload.face) || new Vec3(0, 1, 0)
      if (directTarget && !reference) {
        // Treat raw x/y/z payload as desired placement target and infer support block below.
        reference = new Vec3(directTarget.x, directTarget.y - 1, directTarget.z)
        face = new Vec3(0, 1, 0)
      }

      if (!reference) return { ok: false, error: 'reference{x,y,z} is required' }

      const refBlock = bot.blockAt(reference)
      if (!refBlock) return { ok: false, error: 'reference block not found' }
      if (!isBlockReachableLikePlayer(refBlock, 4.6)) {
        return { ok: false, error: 'reference block is not reachable with normal survival interaction (distance/line-of-sight)' }
      }
      if (!bot.heldItem) return { ok: false, error: 'cannot place: no block item equipped in hand' }

      await bot.placeBlock(refBlock, face)
      pushMemory('action_place', { reference, face })
      return { ok: true, reference, face }
    }

    if (name === 'equip') {
      const destination = payload.destination || 'hand'
      let item = null
      const requestedItemName = String(payload.itemName || payload.item || '').trim()
      if (requestedItemName) {
        item = bot.inventory.items().find((it) => it.name === requestedItemName)
      } else if (Number.isFinite(Number(payload.itemId))) {
        item = bot.inventory.items().find((it) => it.type === Number(payload.itemId))
      }
      if (!item) return { ok: false, error: 'item not found in inventory' }
      await bot.equip(item, destination)
      pushMemory('action_equip', { item: item.name, destination })
      return { ok: true, item: item.name, destination }
    }

    if (name === 'interact') {
      const blockTarget = parseVec3(payload.position) || parseVec3(payload.target) || parseVec3(payload)
      if (blockTarget) {
        const block = bot.blockAt(blockTarget)
        if (!block) return { ok: false, error: 'block not found (use position{x,y,z})' }
        if (!isBlockReachableLikePlayer(block, 4.6)) {
          return { ok: false, error: 'block is not reachable with normal survival interaction (distance/line-of-sight)' }
        }
        await bot.activateBlock(block)
        pushMemory('action_interact_block', { position: blockTarget, name: block.name })
        return { ok: true, block: block.name, position: blockTarget }
      }

      let entity = null
      if (Number.isFinite(Number(payload.entityId))) {
        entity = bot.entities[Number(payload.entityId)]
      } else if (payload.username) {
        entity = Object.values(bot.entities).find((e) => e.username === payload.username)
      }
      if (!entity) return { ok: false, error: 'entity not found (use entityId or username)' }
      if (distanceToPosition(entity.position) > 4.2 || !canSeeEntityLikePlayer(entity)) {
        return { ok: false, error: 'entity is not reachable with normal survival interaction (distance/line-of-sight)' }
      }

      bot.activateEntity(entity)
      pushMemory('action_interact', { entityId: entity.id, name: entity.username || entity.name || 'unknown' })
      return { ok: true, entityId: entity.id }
    }

    if (name === 'attack') {
      let entity = null
      if (Number.isFinite(Number(payload.entityId))) {
        entity = bot.entities[Number(payload.entityId)]
      } else if (payload.username) {
        entity = Object.values(bot.entities).find((e) => e.username === payload.username)
      } else if (payload.name) {
        entity = Object.values(bot.entities).find((e) => String(e.name || '').toLowerCase() === String(payload.name).toLowerCase())
      }
      if (!entity) return { ok: false, error: 'entity not found (use entityId, username, or name)' }
      if (distanceToPosition(entity.position) > 4.2 || !canSeeEntityLikePlayer(entity)) {
        return { ok: false, error: 'entity is not reachable with normal survival interaction (distance/line-of-sight)' }
      }
      bot.attack(entity)
      pushMemory('action_attack', {
        entityId: entity.id,
        name: entity.username || entity.name || 'unknown',
      })
      return { ok: true, entityId: entity.id }
    }

    if (name === 'useItem') {
      const durationMs = Number.isFinite(Number(payload.durationMs)) ? Number(payload.durationMs) : 250
      bot.activateItem(payload.offhand === true)
      await new Promise((resolve) => setTimeout(resolve, durationMs))
      bot.deactivateItem()
      pushMemory('action_use_item', { durationMs, offhand: payload.offhand === true })
      return { ok: true, durationMs }
    }

    if (name === 'craft') {
      let itemName = String(payload.itemName || payload.item || payload.recipe || '').trim()
      itemName = resolveCraftItemName(itemName)
      const count = Number.isFinite(Number(payload.count)) ? Number(payload.count) : 1
      if (!itemName) return { ok: false, error: 'itemName is required' }

      const item = bot.registry.itemsByName[itemName]
      if (!item) return { ok: false, error: `unknown item: ${itemName}` }

      const tablePos = parseVec3(payload.table)
      const table = tablePos ? bot.blockAt(tablePos) : null
      if (tablePos && !table) return { ok: false, error: 'crafting table block not found at table position' }
      if (table && !isBlockReachableLikePlayer(table, 4.6)) {
        return { ok: false, error: 'crafting table not reachable with normal survival interaction' }
      }
      const recipes = bot.recipesFor(item.id, null, count, table)
      const recipe = recipes[0]
      if (!recipe) return { ok: false, error: `no recipe available for ${itemName}` }

      const preCount = inventoryCountByName(itemName)
      await bot.craft(recipe, count, table || null)
      await wait(120)
      const postCount = inventoryCountByName(itemName)
      const delta = postCount - preCount
      if (delta <= 0) {
        return { ok: false, error: `craft produced no ${itemName}; likely blocked or insufficient materials` }
      }
      pushMemory('action_craft', { itemName, count, table: tablePos })
      return { ok: true, itemName, count, produced: delta }
    }

    return { ok: false, error: `unknown action: ${name}` }
  } catch (err) {
    pushMemory('action_error', { action: name, error: err?.message || String(err) })
    return { ok: false, error: err?.message || String(err) }
  }
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

    const reqUrl = new URL(req.url, `http://${config.controlHost}:${config.controlPort}`)

    if (req.method === 'GET' && reqUrl.pathname === '/status') {
      return writeJson(res, 200, {
        ok: true,
        connected,
        host: config.host,
        port: config.port,
        auth: config.auth,
        reconnectPending: Boolean(reconnectTimer),
        viewer: config.viewerEnabled
          ? {
              enabled: true,
              host: config.viewerHost,
              port: config.viewerPort,
              firstPerson: config.viewerFirstPerson,
              url: `http://${config.viewerHost}:${config.viewerPort}`,
              started: viewerStarted,
            }
          : { enabled: false },
        capabilities: CAPABILITIES,
        autonomy: {
          enabled: autonomy.enabled,
          inFlight: autonomy.inFlight,
          iteration: autonomy.iteration,
          goal: runtimeGoal,
          verboseLogs: config.autonomousVerboseLogs,
          allowDestructive: config.autonomousAllowDestructive,
          lastError: autonomy.lastError,
          lastDecision: autonomy.lastDecision,
          lastActionResult: autonomy.lastActionResult,
          model: config.openrouterModel,
        },
        reflection: {
          enabled: reflector.enabled,
          inFlight: reflector.inFlight,
          iteration: reflector.iteration,
          intervalMs: config.autonomousReflectionIntervalMs,
        },
        objective: {
          type: objectiveState.type,
          retries: objectiveState.retries,
          target: objectiveState.target,
          baselineWood: objectiveState.baselineWood,
          ageMs: objectiveState.createdAt ? Date.now() - objectiveState.createdAt : 0,
        },
        directive: getActiveDirective(),
        explorer: {
          enabled: explorer.enabled,
          home: explorer.home,
          lastTarget: explorer.lastTarget,
        },
        state: {
          file: stateFilePath(),
        },
        observation: buildObservation(),
      })
    }

    if (req.method === 'GET' && reqUrl.pathname === '/autonomy') {
      return writeJson(res, 200, {
        ok: true,
        enabled: autonomy.enabled,
        inFlight: autonomy.inFlight,
        iteration: autonomy.iteration,
        goal: runtimeGoal,
        verboseLogs: config.autonomousVerboseLogs,
        allowDestructive: config.autonomousAllowDestructive,
        lastError: autonomy.lastError,
        lastDecision: autonomy.lastDecision,
        lastActionResult: autonomy.lastActionResult,
        model: config.openrouterModel,
        reflection: {
          enabled: reflector.enabled,
          inFlight: reflector.inFlight,
          iteration: reflector.iteration,
          intervalMs: config.autonomousReflectionIntervalMs,
        },
        objective: {
          type: objectiveState.type,
          retries: objectiveState.retries,
          target: objectiveState.target,
          baselineWood: objectiveState.baselineWood,
          ageMs: objectiveState.createdAt ? Date.now() - objectiveState.createdAt : 0,
        },
        directive: getActiveDirective(),
        explorer: {
          enabled: explorer.enabled,
          home: explorer.home,
          lastTarget: explorer.lastTarget,
        },
      })
    }

    if (req.method === 'GET' && reqUrl.pathname === '/goal') {
      return writeJson(res, 200, { ok: true, goal: runtimeGoal })
    }

    if (req.method === 'GET' && reqUrl.pathname === '/memory') {
      const limitRaw = Number(reqUrl.searchParams.get('limit') || '50')
      const limit = Math.max(1, Math.min(config.memorySize, Number.isFinite(limitRaw) ? limitRaw : 50))
      return writeJson(res, 200, {
        ok: true,
        count: Math.min(limit, memory.length),
        events: memory.slice(-limit),
      })
    }

    if (req.method === 'POST' && reqUrl.pathname === '/command') {
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

    if (req.method === 'POST' && reqUrl.pathname === '/action') {
      try {
        const raw = await parseBody(req)
        const payload = raw ? JSON.parse(raw) : {}
        const result = await runAction(payload.action, payload.payload || payload)
        return writeJson(res, result.ok ? 200 : 400, result)
      } catch (err) {
        return writeJson(res, 400, { ok: false, error: err.message })
      }
    }

    if (req.method === 'POST' && reqUrl.pathname === '/reconnect') {
      const result = send(':reconnect')
      return writeJson(res, result.ok ? 200 : 400, result)
    }

    if (req.method === 'POST' && reqUrl.pathname === '/autonomy/start') {
      const result = startAutonomy('api')
      return writeJson(res, result.ok ? 200 : 400, result)
    }

    if (req.method === 'POST' && reqUrl.pathname === '/autonomy/stop') {
      const result = stopAutonomy('api')
      return writeJson(res, result.ok ? 200 : 400, result)
    }

    if (req.method === 'POST' && reqUrl.pathname === '/goal') {
      try {
        const raw = await parseBody(req)
        const payload = raw ? JSON.parse(raw) : {}
        const result = setRuntimeGoal(payload.goal, 'api')
        return writeJson(res, result.ok ? 200 : 400, result)
      } catch (err) {
        return writeJson(res, 400, { ok: false, error: err.message })
      }
    }

    if (req.method === 'POST' && reqUrl.pathname === '/explore/start') {
      explorer.enabled = true
      pushMemory('explore_toggle', { enabled: true, by: 'api' })
      scheduleExploreTick(300)
      return writeJson(res, 200, { ok: true, message: 'explore enabled' })
    }

    if (req.method === 'POST' && reqUrl.pathname === '/explore/stop') {
      explorer.enabled = false
      if (explorer.timer) clearTimeout(explorer.timer)
      explorer.timer = null
      if (bot?.pathfinder && !explicitMove.inProgress) bot.pathfinder.stop()
      pushMemory('explore_toggle', { enabled: false, by: 'api' })
      return writeJson(res, 200, { ok: true, message: 'explore disabled' })
    }

    if (req.method === 'POST' && reqUrl.pathname === '/quit') {
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
console.log('[CTRL] interactive ready. Use /server, :where, :servers, :reconnect, :status, :goal <text>, :autonomy on|off|status, :explore on|off, :quit')
rl.on('line', async (line) => {
  const trimmed = String(line || '').trim()
  if (trimmed.startsWith(':action ')) {
    try {
      const payload = JSON.parse(trimmed.slice(8))
      const result = await runAction(payload.action, payload.payload || payload)
      console.log('[ACTION]', JSON.stringify(result))
    } catch (err) {
      console.log('[ACTION] invalid JSON payload', err?.message || err)
    }
    return
  }

  const result = send(trimmed)
  if (!result.ok) {
    console.log(`[CTRL] ${result.message}`)
  } else if (trimmed === ':status') {
    console.log(result.message)
  }
})

process.on('SIGINT', () => {
  console.log('\n[CTRL] SIGINT')
  persistState()
  send(':quit')
  process.exit(0)
})

restoreState()
startControlServer()
if (autonomy.enabled) {
  console.log(`[AUTO] configured enabled on boot (model=${config.openrouterModel})`)
  pushMemory('autonomy_boot_enabled', { model: config.openrouterModel })
}
connect('initial boot')
