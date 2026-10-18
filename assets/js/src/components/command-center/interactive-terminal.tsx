import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from '@pimcore/studio-ui-bundle/app'
import { Alert, Button, Flex, Text } from '@pimcore/studio-ui-bundle/components'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { commandCenterUrl } from './api'
import { TerminalConnection, type TerminalStatus } from './terminal-connection'
import { terminalStyle } from './interactive-terminal.styles'

export interface InteractiveTerminalProps {
  active: boolean
  csrfToken: string
}

export const InteractiveTerminal = ({ active, csrfToken }: InteractiveTerminalProps): React.JSX.Element => {
  const { t } = useTranslation()
  const host = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal>()
  const fit = useRef<FitAddon>()
  const connection = useRef<TerminalConnection>()
  const csrf = useRef(csrfToken)
  csrf.current = csrfToken
  const [enabled, setEnabled] = useState(false)
  const [status, setStatus] = useState<TerminalStatus>('disconnected')
  const [error, setError] = useState('')

  useEffect(() => {
    const abort = new AbortController()
    void fetch(commandCenterUrl('terminal/settings'), { signal: abort.signal }).then(async response => {
      if (!response.ok) throw new Error()
      const settings = await response.json() as { enabled: boolean }
      setEnabled(settings.enabled)
    }).catch(() => { if (!abort.signal.aborted) setError('command-center.terminal.unavailable') })
    return () => { abort.abort() }
  }, [])

  useEffect(() => {
    if (!enabled || host.current === null) return
    const term = new Terminal({
      cursorBlink: true, scrollback: 5000, fontSize: 14,
      theme: { background: '#111827', foreground: '#e5e7eb' },
      screenReaderMode: true, allowProposedApi: false
    })
    const addon = new FitAddon()
    term.loadAddon(addon)
    term.open(host.current)
    terminal.current = term
    fit.current = addon
    const transport = new TerminalConnection({
      csrfToken: () => csrf.current,
      dimensions: () => ({ cols: term.cols, rows: term.rows }),
      output: data => term.write(data),
      status: value => { setStatus(value); if (value === 'connected') term.focus() },
      error: () => setError('command-center.terminal.unavailable')
    })
    connection.current = transport
    const input = term.onData(data => transport.input(data))
    const resized = term.onResize(() => transport.resize())
    const observer = new ResizeObserver(() => {
      if (host.current !== null && host.current.clientWidth > 0) addon.fit()
    })
    observer.observe(host.current)
    const close = (): void => transport.stop()
    window.addEventListener('pagehide', close)
    return () => {
      window.removeEventListener('pagehide', close)
      observer.disconnect()
      transport.stop()
      input.dispose()
      resized.dispose()
      term.dispose()
      connection.current = undefined
      terminal.current = undefined
    }
  }, [enabled])

  useEffect(() => {
    if (active && enabled) {
      fit.current?.fit()
      terminal.current?.textarea?.setAttribute('aria-label', t('command-center.terminal.input'))
    }
  }, [active, enabled, t])

  const clipboard = async (paste: boolean): Promise<void> => {
    try {
      if (paste) terminal.current?.paste(await navigator.clipboard.readText())
      else await navigator.clipboard.writeText(terminal.current?.getSelection() ?? '')
      terminal.current?.focus()
    } catch {
      setError('command-center.terminal.clipboard-error')
    }
  }

  return (
    <Flex vertical gap={16}>
      <Text>{t('command-center.terminal.help')}</Text>
      {!enabled && <Alert type="info" message={t('command-center.terminal.disabled')} />}
      <Flex gap={8} wrap align="center">
        <Button type="primary" disabled={!enabled || csrfToken === '' || status !== 'disconnected'} onClick={() => {
          setError('')
          terminal.current?.reset()
          fit.current?.fit()
          connection.current?.start()
        }}>{t('command-center.terminal.connect')}</Button>
        <Button disabled={status === 'disconnected'} onClick={() => connection.current?.stop()}>{t('command-center.terminal.disconnect')}</Button>
        <Button disabled={!enabled} onClick={() => terminal.current?.clear()}>{t('command-center.terminal.clear')}</Button>
        <Button disabled={!enabled} onClick={() => { void clipboard(false) }}>{t('command-center.terminal.copy')}</Button>
        <Button disabled={status !== 'connected'} onClick={() => { void clipboard(true) }}>{t('command-center.terminal.paste')}</Button>
        <Text role="status">{t(`command-center.terminal.status.${status}`)}</Text>
      </Flex>
      {error !== '' && <Alert type="error" message={t(error)} />}
      {enabled && <div ref={host} style={terminalStyle} />}
    </Flex>
  )
}
