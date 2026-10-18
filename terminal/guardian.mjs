// Eigener PTY-Sitzungsleiter: räumt auch bei einem SIGKILL des Dienstes auf.
import { spawn } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'

const parent = Number(process.argv[2])
let stopping = false
const shell = spawn(process.argv[3], ['-i'], { stdio: 'inherit' })

const signalSession = signal => {
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, 'utf8')
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
      if (Number(fields[3]) === process.pid) process.kill(Number(entry), signal)
    } catch { /* Prozess kann zwischen Auflistung und Signal bereits beendet sein. */ }
  }
}

const stop = (code = 0) => {
  if (stopping) return
  stopping = true
  signalSession('SIGTERM')
  setTimeout(() => {
    signalSession('SIGKILL')
    process.exit(code)
  }, 200)
}

shell.on('exit', code => stop(code ?? 1))
shell.on('error', () => stop(1))
for (const signal of ['SIGTERM', 'SIGHUP', 'SIGINT']) process.on(signal, () => stop())
setInterval(() => {
  if (process.ppid !== parent) stop()
}, 250)
