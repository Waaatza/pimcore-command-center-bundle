import { commandCenterUrl } from './api'

export type TerminalStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

export interface TerminalConnectionOptions {
  csrfToken: () => string
  dimensions: () => { cols: number, rows: number }
  output: (data: string) => void
  status: (status: TerminalStatus) => void
  error: () => void
}

export class TerminalConnection {
  private socket?: WebSocket
  private request?: AbortController
  private retry?: ReturnType<typeof setTimeout>
  private renewal?: ReturnType<typeof setTimeout>
  private sessionId: string | null = null
  private stopped = true
  private ready = false
  private deadline = 0

  constructor (private readonly options: TerminalConnectionOptions) {}

  start (): void {
    if (!this.stopped) return
    this.stopped = false
    this.ready = false
    this.sessionId = null
    this.options.status('connecting')
    void this.open()
  }

  stop (): void {
    this.stopped = true
    this.ready = false
    clearTimeout(this.retry)
    clearTimeout(this.renewal)
    this.request?.abort()
    this.send({ type: 'disconnect' })
    this.socket?.close()
    this.socket = undefined
    this.sessionId = null
    this.options.status('disconnected')
  }

  input (data: string): void {
    // Nur nach ready senden; der Dienst verlangt die Authentifizierung als erste Nachricht.
    if (!this.ready) return
    // Große Einfügeaktionen zerlegen, ohne dabei ein Surrogatpaar (z.B. Emoji) zu trennen.
    const size = 4096
    let start = 0
    while (start < data.length) {
      let end = Math.min(start + size, data.length)
      const last = data.charCodeAt(end - 1)
      if (end < data.length && last >= 0xd800 && last <= 0xdbff) end++
      this.send({ type: 'input', data: data.slice(start, end) })
      start = end
    }
  }

  resize (): void {
    if (!this.ready) return
    this.send({ type: 'resize', ...this.options.dimensions() })
  }

  private send (message: object): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message))
  }

  private fail (): void {
    if (this.stopped) return
    if (this.sessionId !== null && Date.now() < this.deadline) {
      this.options.status('reconnecting')
      this.retry = setTimeout(() => { void this.open() }, 500)
    } else {
      this.stop()
      this.options.error()
    }
  }

  private async open (): Promise<void> {
    this.ready = false
    const abort = new AbortController()
    this.request = abort
    const timeout = setTimeout(() => abort.abort(), 5000)
    try {
      const response = await fetch(commandCenterUrl('terminal/ticket'), {
        method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csrfToken: this.options.csrfToken(), sessionId: this.sessionId })
      })
      if (!response.ok) throw new Error('Ticket unavailable')
      const ticket = await response.json() as { ticket: string, websocketPath: string }
      if (this.stopped || this.request !== abort) return
      const url = new URL(ticket.websocketPath, window.location.origin)
      if (url.origin !== window.location.origin) throw new Error('Invalid terminal URL')
      url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(url)
      this.socket = socket
      const handshake = setTimeout(() => socket.close(), 6000)
      socket.onopen = () => {
        if (this.stopped) { socket.close(); return }
        socket.send(JSON.stringify({ type: 'authenticate', ticket: ticket.ticket, ...this.options.dimensions() }))
      }
      socket.onmessage = event => {
        if (this.stopped || this.socket !== socket) return
        try {
          const message = JSON.parse(String(event.data)) as { type: string, sessionId?: string, data?: string }
          if (message.type === 'ready' && typeof message.sessionId === 'string') {
            this.ready = true
            clearTimeout(handshake)
            this.sessionId = message.sessionId
            this.deadline = 0
            this.options.status('connected')
            this.scheduleRenewal()
            this.resize()
          } else if (message.type === 'output' && typeof message.data === 'string') {
            this.options.output(message.data)
          } else if (message.type === 'exit') {
            this.stop()
          } else {
            this.stop()
            this.options.error()
          }
        } catch {
          this.stop()
          this.options.error()
        }
      }
      socket.onerror = () => { socket.close() }
      socket.onclose = () => {
        clearTimeout(handshake)
        clearTimeout(this.renewal)
        if (this.stopped || this.socket !== socket) return
        this.socket = undefined
        if (this.ready) this.deadline = Date.now() + 15000
        this.ready = false
        this.fail()
      }
    } catch {
      if (!this.stopped && this.request === abort) this.fail()
    } finally {
      clearTimeout(timeout)
    }
  }

  // Die Autorisierung erlischt serverseitig; regelmäßig mit einem frischen Einmalticket verlängern.
  private scheduleRenewal (): void {
    clearTimeout(this.renewal)
    this.renewal = setTimeout(() => { void this.renew() }, 30000)
  }

  private async renew (): Promise<void> {
    if (this.stopped || !this.ready) return
    const abort = new AbortController()
    const timeout = setTimeout(() => abort.abort(), 5000)
    try {
      const response = await fetch(commandCenterUrl('terminal/ticket'), {
        method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csrfToken: this.options.csrfToken(), sessionId: this.sessionId })
      })
      if (!response.ok) throw new Error('Ticket unavailable')
      const { ticket } = await response.json() as { ticket: string }
      if (this.stopped || !this.ready) return
      this.send({ type: 'renew', ticket })
      this.scheduleRenewal()
    } catch {
      if (!this.stopped) { this.stop(); this.options.error() }
    } finally {
      clearTimeout(timeout)
    }
  }
}
