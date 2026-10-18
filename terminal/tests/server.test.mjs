import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { spawn as childProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'
import { configuration, createTerminalServer } from '../server.mjs'

const owner = 'a'.repeat(64)
const waitFor = async predicate => {
  for (let i = 0; i < 250; i++) {
    if (await predicate()) return
    await delay(20)
  }
  assert.fail('Timed out waiting for terminal state.')
}
const running = async pid => {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8')
    return stat.slice(stat.lastIndexOf(')') + 2)[0] !== 'Z'
  } catch { return false }
}

async function fixture(t, external = false, authMs = 60000) {
  const cwd = await mkdtemp(join(tmpdir(), 'command-terminal-'))
  const tickets = new Map()
  const secret = randomBytes(32).toString('hex')
  const backend = http.createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const ticket = JSON.parse(body).ticket
    const identity = tickets.get(ticket)
    tickets.delete(ticket)
    if (!identity || request.headers.authorization !== `Bearer ${secret}`) { response.writeHead(403); response.end(); return }
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(identity))
  })
  backend.listen(0, '127.0.0.1')
  await once(backend, 'listening')
  const config = {
    origin: 'http://studio.test', secret, cwd, shell: '/bin/bash',
    path: '/command-center-terminal', host: '127.0.0.1', port: 0,
    consumeUrl: `http://127.0.0.1:${backend.address().port}/consume`, reconnectMs: 250, authMs
  }
  let terminal, child, port
  const sockets = []
  if (external) {
    const reservation = http.createServer()
    reservation.listen(0, '127.0.0.1')
    await once(reservation, 'listening')
    port = reservation.address().port
    await new Promise(resolve => reservation.close(resolve))
    child = childProcess(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
      stdio: 'ignore', env: {
        ...process.env, COMMAND_CENTER_TERMINAL_ENABLED: '1', COMMAND_CENTER_TERMINAL_SECRET: secret,
        COMMAND_CENTER_TERMINAL_ORIGIN: config.origin, COMMAND_CENTER_TERMINAL_CWD: cwd,
        COMMAND_CENTER_TERMINAL_CONSUME_URL: config.consumeUrl, COMMAND_CENTER_TERMINAL_PORT: String(port)
      }
    })
    await waitFor(async () => {
      try { await fetch(`http://127.0.0.1:${port}`); return true } catch { return false }
    })
  } else {
    terminal = createTerminalServer(config)
    terminal.server.listen(0, config.host)
    await once(terminal.server, 'listening')
    port = terminal.server.address().port
  }
  t.after(async () => {
    for (const socket of sockets) socket.terminate()
    if (terminal) await terminal.close()
    if (child && child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, 'exit') }
    await new Promise(resolve => backend.close(resolve))
    await delay(300)
    await rm(cwd, { recursive: true, force: true })
  })
  const issue = (sessionId = null, ticketOwner = owner) => {
    const ticket = randomBytes(32).toString('hex')
    tickets.set(ticket, { owner: ticketOwner, sessionId })
    return ticket
  }
  const connect = async (ticket, origin = config.origin) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${config.path}`, { origin })
    sockets.push(socket)
    const messages = []
    socket.on('message', raw => messages.push(JSON.parse(raw.toString())))
    await once(socket, 'open')
    const send = message => socket.send(JSON.stringify(message))
    if (ticket) send({ type: 'authenticate', ticket, cols: 100, rows: 30 })
    return {
      socket, messages, send,
      input: data => send({ type: 'input', data }),
      output: () => messages.filter(m => m.type === 'output').map(m => m.data).join(''),
      ready: async () => {
        await waitFor(() => messages.some(m => m.type === 'ready'))
        return messages.find(m => m.type === 'ready').sessionId
      }
    }
  }
  return { cwd, issue, connect, child, port }
}

test('configuration refuses root and malformed origin', () => {
  assert.throws(() => configuration({}))
  if (process.getuid() === 0) return
  assert.throws(() => configuration({
    COMMAND_CENTER_TERMINAL_ORIGIN: 'http://studio.test/path', COMMAND_CENTER_TERMINAL_SECRET: 's'.repeat(40),
    COMMAND_CENTER_TERMINAL_CWD: '/tmp', COMMAND_CENTER_TERMINAL_CONSUME_URL: 'http://127.0.0.1/consume'
  }))
})

test('interactive shell: cwd, pipes, Unicode, color, resize, prompts and Ctrl+C', async t => {
  const f = await fixture(t)
  const client = await f.connect(f.issue())
  await client.ready()
  client.input("stty -echo; printf '\\nREADY\\n'\r")
  await waitFor(() => client.output().includes('\r\nREADY\r\n'))
  client.input("cd /tmp; printf '\\nDIR=%s\\n' \"$PWD\"; printf 'grün' | cat; printf '\\033[31mCOLOR\\033[0m\\n'\r")
  await waitFor(() => client.output().includes('DIR=/tmp') && client.output().includes('grün') && client.output().includes('\x1b[31mCOLOR'))
  client.send({ type: 'resize', cols: 123, rows: 41 })
  client.input('stty size\r')
  await waitFor(() => client.output().includes('41 123'))
  client.input("read -r -p 'ANSWER? ' answer; printf '\\nANSWER=%s\\n' \"$answer\"\r")
  await waitFor(() => client.output().includes('ANSWER?'))
  client.input('yes\r')
  await waitFor(() => client.output().includes('ANSWER=yes'))
  client.input('sleep 12345\r')
  await delay(100)
  client.input('\x03')
  client.input("printf '\\nAFTER_INTERRUPT\\n'\r")
  await waitFor(() => client.output().includes('\r\nAFTER_INTERRUPT\r\n'))
  client.send({ type: 'disconnect' })
  await once(client.socket, 'close')
})

test('authentication, replay, owner isolation and reconnect preserve one shell', async t => {
  const f = await fixture(t)
  await assert.rejects(() => f.connect(f.issue(), 'http://attacker.test'))
  const unauthenticated = await f.connect()
  unauthenticated.send({ type: 'input', data: 'echo forbidden\r' })
  await once(unauthenticated.socket, 'close')
  assert(!unauthenticated.messages.some(m => m.type === 'ready'))
  const ticket = f.issue()
  const first = await f.connect(ticket)
  const id = await first.ready()
  first.input("stty -echo; marker=preserved; printf '\\nSET\\n'\r")
  await waitFor(() => first.output().includes('\r\nSET\r\n'))
  const replay = await f.connect(ticket)
  await once(replay.socket, 'close')
  assert(!replay.messages.some(m => m.type === 'ready'))
  first.socket.terminate()
  await delay(30)
  const foreign = await f.connect(f.issue(id, 'b'.repeat(64)))
  await once(foreign.socket, 'close')
  assert(!foreign.messages.some(m => m.type === 'ready'))
  const resumed = await f.connect(f.issue(id))
  assert.equal(await resumed.ready(), id)
  resumed.input("printf '\\nVALUE=%s\\n' \"$marker\"\r")
  await waitFor(() => resumed.output().includes('VALUE=preserved'))
  const other = await f.connect(f.issue(null, 'b'.repeat(64)))
  assert.notEqual(await other.ready(), id)
  other.input("stty -echo; printf '\\nOTHER=%s\\n' \"${marker-unset}\"\r")
  await waitFor(() => other.output().includes('\r\nOTHER=unset\r\n'))
  resumed.send({ type: 'disconnect' })
  await once(resumed.socket, 'close')
  other.send({ type: 'disconnect' })
  await once(other.socket, 'close')
})

test('expired authorization ends the shell unless renewed with a fresh ticket', async t => {
  const f = await fixture(t, false, 1000)
  const client = await f.connect(f.issue())
  const id = await client.ready()
  for (let i = 0; i < 6; i++) { client.send({ type: 'renew', ticket: f.issue() }); await delay(300) }
  assert.equal(client.socket.readyState, WebSocket.OPEN)
  assert(!client.messages.some(m => m.type === 'exit'))
  await once(client.socket, 'close')
  const expired = await f.connect(f.issue(id))
  await once(expired.socket, 'close')
  assert(!expired.messages.some(m => m.type === 'ready'))
})

test('normal shell exit closes only its own session', async t => {
  const f = await fixture(t)
  const first = await f.connect(f.issue())
  const second = await f.connect(f.issue())
  await first.ready()
  await second.ready()
  first.input('exit 7\r')
  await once(first.socket, 'close')
  assert.equal(first.messages.find(m => m.type === 'exit')?.code, 7)
  second.input("stty -echo; printf '\\nSTILL_ALIVE\\n'\r")
  await waitFor(() => second.output().includes('\r\nSTILL_ALIVE\r\n'))
  second.send({ type: 'disconnect' })
  await once(second.socket, 'close')
})

test('explicit disconnect and expired grace period kill child processes', async t => {
  const f = await fixture(t)
  for (const explicit of [true, false]) {
    const client = await f.connect(f.issue())
    const id = await client.ready()
    client.input("sleep 12345 & printf '\\nSHELL=%s GUARD=%s CHILD=%s\\n' \"$$\" \"$PPID\" \"$!\"\r")
    await waitFor(() => /\r\nSHELL=(\d+) GUARD=(\d+) CHILD=(\d+)\r\n/.test(client.output()))
    const pids = client.output().match(/\r\nSHELL=(\d+) GUARD=(\d+) CHILD=(\d+)\r\n/).slice(1).map(Number)
    const pid = pids[2]
    assert(await running(pid))
    if (explicit) client.send({ type: 'disconnect' })
    else client.socket.terminate()
    await waitFor(async () => (await Promise.all(pids.map(running))).every(value => !value))
    const expired = await f.connect(f.issue(id))
    await once(expired.socket, 'close')
    assert(!expired.messages.some(m => m.type === 'ready'))
  }
})

test('SIGKILL of the daemon leaves no running terminal children', { skip: process.getuid() === 0 }, async t => {
  const f = await fixture(t, true)
  const client = await f.connect(f.issue())
  await client.ready()
  client.input("sleep 12345 & printf '\\nSHELL=%s GUARD=%s CHILD=%s\\n' \"$$\" \"$PPID\" \"$!\"\r")
  await waitFor(() => /\r\nSHELL=(\d+) GUARD=(\d+) CHILD=(\d+)\r\n/.test(client.output()))
  const pids = client.output().match(/\r\nSHELL=(\d+) GUARD=(\d+) CHILD=(\d+)\r\n/).slice(1).map(Number)
  const pid = pids[2]
  assert(await running(pid))
  f.child.kill('SIGKILL')
  await once(f.child, 'exit')
  await waitFor(async () => (await Promise.all(pids.map(running))).every(value => !value))
})
