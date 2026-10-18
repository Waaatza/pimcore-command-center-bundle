import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { setImmediate } from 'node:timers/promises'
import ts from 'typescript'

const exports = {}
const sockets = []
const requests = []
const timers = new Map()
let timerId = 0
let now = 1000
let pending
class Socket {
  static OPEN = 1
  readyState = 0
  sent = []
  constructor (url) { this.url = url; sockets.push(this) }
  send (data) { this.sent.push(JSON.parse(data)) }
  close () { this.readyState = 3; this.onclose?.() }
  open () { this.readyState = 1; this.onopen?.() }
  message (message) { this.onmessage?.({ data: JSON.stringify(message) }) }
}
const source = readFileSync(new URL('../js/src/components/command-center/terminal-connection.ts', import.meta.url), 'utf8')
runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, {
  exports, require: () => ({ commandCenterUrl: path => path }),
  AbortController, URL, WebSocket: Socket,
  Date: { now: () => now },
  window: { location: { origin: 'https://studio.test', protocol: 'https:' } },
  setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id },
  clearTimeout: id => timers.delete(id),
  fetch: async (path, options) => {
    requests.push({ path, options, body: JSON.parse(options.body) })
    return pending ?? { ok: true, json: async () => ({ ticket: 'secret-ticket', websocketPath: '/command-center-terminal' }) }
  }
})
const settle = async () => { await setImmediate(); await setImmediate() }
const statuses = [], outputs = []
let errors = 0
const client = new exports.TerminalConnection({
  csrfToken: () => 'csrf', dimensions: () => ({ cols: 100, rows: 30 }),
  output: value => outputs.push(value), status: value => statuses.push(value), error: () => errors++
})
assert.equal(requests.length, 0, 'Shell connected before explicit start')
client.start()
await settle()
const first = sockets.at(-1)
assert.equal(first.url.href, 'wss://studio.test/command-center-terminal')
assert.equal(first.url.href.includes('ticket'), false)
first.open()
assert.equal(first.sent.length, 1, 'unexpected message before ready')
assert.equal(first.sent[0].type, 'authenticate')
assert.equal(first.sent[0].ticket, 'secret-ticket')
// Vor ready dürfen weder Eingaben noch Größenänderungen gesendet werden.
client.input('early')
client.resize()
assert.equal(first.sent.length, 1, 'input/resize sent before ready')
first.message({ type: 'ready', sessionId: 'a'.repeat(32) })
first.message({ type: 'output', data: 'hello' })
assert.equal(outputs[0], 'hello')
// Die Autorisierung wird regelmäßig mit einem frischen Ticket erneuert.
const renewal = [...timers.entries()].find(([, timer]) => timer.ms === 30000)
assert(renewal, 'renewal not scheduled')
timers.delete(renewal[0]); renewal[1].fn()
await settle()
assert.equal(first.sent.at(-1).type, 'renew')
assert.equal(first.sent.at(-1).ticket, 'secret-ticket')
// Große Einfügeaktionen dürfen kein Surrogatpaar an der Chunk-Grenze trennen.
const pasted = 'x'.repeat(4095) + '😀' + 'y'
client.input(pasted)
const chunks = first.sent.filter(m => m.type === 'input').map(m => m.data)
assert.equal(chunks.join(''), pasted)
assert(chunks.length >= 2, 'expected the paste to be split')
for (const chunk of chunks) {
  assert(!(chunk.charCodeAt(0) >= 0xdc00 && chunk.charCodeAt(0) <= 0xdfff), 'chunk starts with a low surrogate')
  assert(!(chunk.charCodeAt(chunk.length - 1) >= 0xd800 && chunk.charCodeAt(chunk.length - 1) <= 0xdbff), 'chunk ends with a high surrogate')
}
client.input('\x03')
assert.equal(first.sent.at(-1).data, '\x03')
first.close()
assert.equal(statuses.at(-1), 'reconnecting')
const retry = [...timers.entries()].find(([, timer]) => timer.ms === 500)
timers.delete(retry[0]); retry[1].fn()
await settle()
assert.equal(requests.at(-1).body.sessionId, 'a'.repeat(32))
assert.equal(requests.at(-1).body.csrfToken, 'csrf')
const resumed = sockets.at(-1)
resumed.open()
resumed.message({ type: 'ready', sessionId: 'a'.repeat(32) })
client.stop()
assert.equal(resumed.sent.at(-1).type, 'disconnect')
assert.equal(statuses.at(-1), 'disconnected')
assert.equal(timers.size, 0)

// Unmount während der Ticketanfrage darf keine spätere Verbindung öffnen.
let resolveRequest
pending = new Promise(resolve => { resolveRequest = resolve })
client.start()
const count = sockets.length
client.stop()
resolveRequest({ ok: true, json: async () => ({ ticket: 'late', websocketPath: '/command-center-terminal' }) })
await settle()
assert.equal(sockets.length, count)

pending = undefined
client.start()
await settle()
const lost = sockets.at(-1)
lost.open(); lost.message({ type: 'ready', sessionId: 'b'.repeat(32) }); lost.close()
now += 16000
const lastRetry = [...timers.entries()].find(([, timer]) => timer.ms === 500)
timers.delete(lastRetry[0]); lastRetry[1].fn()
pending = { ok: false }
await settle()
const failed = sockets.at(-1)
failed.close()
assert.equal(statuses.at(-1), 'disconnected')
assert.equal(errors, 1)
assert.equal(timers.size, 0)
console.log('Terminal explicit connect, pre-ready gating, renewal, surrogate-safe chunking, reconnect ownership, Ctrl+C and unmount cleanup checked.')
