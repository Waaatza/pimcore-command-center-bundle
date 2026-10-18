import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

const guardian = fileURLToPath(new URL('./guardian.mjs', import.meta.url))
const require = createRequire(import.meta.url)
const dimensions = value => Number.isInteger(value) && value >= 2 && value <= 500

export function configuration(env = process.env) {
  const config = {
    origin: env.COMMAND_CENTER_TERMINAL_ORIGIN,
    secret: env.COMMAND_CENTER_TERMINAL_SECRET,
    consumeUrl: env.COMMAND_CENTER_TERMINAL_CONSUME_URL,
    cwd: env.COMMAND_CENTER_TERMINAL_CWD,
    shell: env.COMMAND_CENTER_TERMINAL_SHELL || '/bin/bash',
    path: env.COMMAND_CENTER_TERMINAL_PATH || '/command-center-terminal',
    host: env.COMMAND_CENTER_TERMINAL_HOST || '127.0.0.1',
    port: Number(env.COMMAND_CENTER_TERMINAL_PORT || 8091),
    reconnectMs: 15000
  }
  if (process.platform !== 'linux' || process.getuid() === 0) throw new Error('Terminal requires Linux and a non-root user.')
  if (!config.origin || new URL(config.origin).origin !== config.origin || !/^https?:/.test(config.origin)
    || !config.secret || config.secret.length < 32 || !config.cwd?.startsWith('/')
    || !config.shell.startsWith('/') || !/^\/[a-zA-Z0-9/_-]+$/.test(config.path)
    || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error('Invalid terminal configuration.')
  }
  const backend = new URL(config.consumeUrl)
  if (!['http:', 'https:'].includes(backend.protocol) || backend.username || backend.password) {
    throw new Error('Invalid terminal backend URL.')
  }
  return config
}

export function createTerminalServer(config) {
  const { spawn } = require('node-pty')
  const { WebSocket, WebSocketServer } = require('ws')
  // Autorisierung läuft ab und muss mit einem frischen Einmalticket erneuert werden.
  const authMs = config.authMs ?? 60000
  const sessions = new Map()
  const server = http.createServer((request, response) => { response.writeHead(404); response.end() })
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false })
  let shuttingDown = false
  const send = (socket, event) => {
    if (socket.readyState !== WebSocket.OPEN) return false
    if (socket.bufferedAmount > 1048576) { socket.terminate(); return false }
    socket.send(JSON.stringify(event))
    return true
  }
  const finish = session => {
    if (!sessions.delete(session.id)) return
    clearTimeout(session.expiry)
    session.pty.kill('SIGTERM')
    session.socket?.close(1000)
  }
  // Sitzungen ohne rechtzeitige Erneuerung beenden.
  const sweep = setInterval(() => {
    const now = Date.now()
    for (const session of sessions.values()) if (session.authUntil <= now) finish(session)
  }, Math.max(50, Math.min(1000, Math.floor(authMs / 2))))
  const consume = async ticket => {
    const response = await fetch(config.consumeUrl, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.secret}` },
      body: JSON.stringify({ ticket })
    })
    if (!response.ok) throw new Error('Ticket rejected.')
    const identity = await response.json()
    if (typeof identity.owner !== 'string' || !/^[a-f0-9]{64}$/.test(identity.owner)
      || (identity.sessionId !== null && !/^[a-f0-9]{32}$/.test(identity.sessionId))) {
      throw new Error('Invalid identity.')
    }
    return identity
  }

  server.on('upgrade', (request, socket, head) => {
    if (shuttingDown || request.url !== config.path || request.headers.origin !== config.origin || wss.clients.size >= 100) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    wss.handleUpgrade(request, socket, head, connection => wss.emit('connection', connection))
  })

  wss.on('connection', socket => {
    let session
    let authenticating = false
    let alive = true
    const authTimeout = setTimeout(() => socket.close(1008), 6000)
    socket.on('error', () => {})
    socket.on('pong', () => { alive = true })
    const heartbeat = setInterval(() => {
      if (!alive) { socket.terminate(); return }
      alive = false
      socket.ping()
    }, 5000)
    socket.on('close', () => {
      clearTimeout(authTimeout)
      clearInterval(heartbeat)
      if (session?.socket === socket) {
        session.socket = null
        session.expiry = setTimeout(() => finish(session), config.reconnectMs)
      }
    })
    socket.on('message', async (raw, binary) => {
      try {
        if (binary) throw new Error('Binary input unsupported.')
        const message = JSON.parse(raw.toString())
        if (message === null || typeof message !== 'object') throw new Error('Invalid message.')
        if (!session) {
          if (authenticating || message.type !== 'authenticate' || !/^[a-f0-9]{64}$/.test(message.ticket)
            || !dimensions(message.cols) || !dimensions(message.rows)) throw new Error('Authentication required.')
          authenticating = true
          const identity = await consume(message.ticket)
          if (socket.readyState !== WebSocket.OPEN || shuttingDown) return
          if (identity.sessionId !== null) {
            const existing = sessions.get(identity.sessionId)
            if (!existing || existing.owner !== identity.owner || existing.socket !== null) {
              throw new Error('Session unavailable.')
            }
            session = existing
            clearTimeout(session.expiry)
            // Nur bei echter Größenänderung resizen, sonst zeichnet die Shell bei jedem Reconnect den Prompt neu.
            if (session.cols !== message.cols || session.rows !== message.rows) {
              session.cols = message.cols
              session.rows = message.rows
              session.pty.resize(message.cols, message.rows)
            }
          } else {
            if (sessions.size >= 20) throw new Error('Terminal capacity reached.')
            // Geheimnis und interne Dienst-Konfiguration nicht an die Shell vererben.
            const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('COMMAND_CENTER_TERMINAL_')))
            const terminal = spawn(process.execPath, [guardian, String(process.pid), config.shell], {
              name: 'xterm-256color', cols: message.cols, rows: message.rows,
              cwd: config.cwd, env: { ...env, HISTFILE: '/dev/null', TERM: 'xterm-256color' }
            })
            session = { id: randomBytes(16).toString('hex'), owner: identity.owner, pty: terminal, socket: null, pending: '', authUntil: 0, cols: message.cols, rows: message.rows }
            const created = session
            sessions.set(session.id, session)
            terminal.onData(data => {
              if (created.socket) send(created.socket, { type: 'output', data })
              else created.pending = (created.pending + data).slice(-262144)
            })
            terminal.onExit(({ exitCode }) => {
              if (created.socket) send(created.socket, { type: 'exit', code: exitCode })
              finish(created)
            })
          }
          session.authUntil = Date.now() + authMs
          session.socket = socket
          clearTimeout(authTimeout)
          send(socket, { type: 'ready', sessionId: session.id })
          if (session.pending) { send(socket, { type: 'output', data: session.pending }); session.pending = '' }
          return
        }
        if (message.type === 'input' && typeof message.data === 'string' && message.data.length <= 16384) {
          session.pty.write(message.data)
        } else if (message.type === 'resize' && dimensions(message.cols) && dimensions(message.rows)) {
          if (session.cols !== message.cols || session.rows !== message.rows) {
            session.cols = message.cols
            session.rows = message.rows
            session.pty.resize(message.cols, message.rows)
          }
        } else if (message.type === 'renew' && typeof message.ticket === 'string' && /^[a-f0-9]{64}$/.test(message.ticket)) {
          const identity = await consume(message.ticket)
          if (identity.owner !== session.owner) throw new Error('Session unavailable.')
          session.authUntil = Date.now() + authMs
        } else if (message.type === 'disconnect') {
          finish(session)
        } else {
          throw new Error('Invalid terminal message.')
        }
      } catch {
        send(socket, { type: 'error' })
        socket.close(1008)
      }
    })
  })

  const close = async () => {
    shuttingDown = true
    clearInterval(sweep)
    for (const session of sessions.values()) finish(session)
    for (const socket of wss.clients) socket.terminate()
    await new Promise(resolve => server.close(resolve))
    wss.close()
  }
  return { server, close }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.COMMAND_CENTER_TERMINAL_ENABLED !== '1') process.exit(0)
  try {
    const config = configuration()
    const terminal = createTerminalServer(config)
    terminal.server.listen(config.port, config.host)
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
      void terminal.close().then(() => { setTimeout(() => process.exit(0), 500) })
    })
    terminal.server.on('error', () => { console.error('Terminal listener failed.'); process.exit(1) })
  } catch {
    console.error('Terminal startup failed. Check Linux, non-root user and terminal configuration.')
    process.exit(1)
  }
}
