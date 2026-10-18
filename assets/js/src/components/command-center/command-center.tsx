import { useTranslation } from '@pimcore/studio-ui-bundle/app'
import { commandCenterUrl } from './api'
import React, { useEffect, useRef, useState } from 'react'
import { Button, Content, TextArea, Select, Tabs } from '@pimcore/studio-ui-bundle/components'

import { ScheduledCommands, type CommandDraft } from './scheduled-commands'

interface Definition {
  name: string
  description: string
  definition: {
    arguments: Record<string, { name: string, description: string, is_required: boolean }>
    options: Record<string, { name: string, description: string }>
  }
}

export const CommandCenter = (): React.JSX.Element => {
  const { t } = useTranslation()
  const [tab, setTab] = useState('direct')
  const [draft, setDraft] = useState<CommandDraft>({ tokens: '[]', phpCode: null, csrfToken: '' })

  return (
    <Content padded padding="large">
      <h2>{t('command-center.ui.title')}</h2>
      <Tabs activeKey={ tab } onChange={ setTab } noPadding items={ [
        { key: 'direct', label: t('command-center.tabs.direct'), children: <CommandRunner onDraftChange={ setDraft } /> },
        { key: 'scheduled', label: t('command-center.tabs.scheduled'), children:
          <ScheduledCommands draft={ draft } active={ tab === 'scheduled' } onEdit={ () => setTab('direct') } /> }
      ] } />
    </Content>
  )
}

const CommandRunner = ({ onDraftChange }: { onDraftChange: (draft: CommandDraft) => void }): React.JSX.Element => {
  const { t } = useTranslation()
  const [csrfToken, setCsrfToken] = useState('')
  const [commands, setCommands] = useState<Definition[]>([])
  const [selected, setSelected] = useState<string>()
  const [tokens, setTokens] = useState('[]')
  const [phpCode, setPhpCode] = useState('<?php\n\necho "Hello from Pimcore!\\n";\n')
  const inlineScript = selected === 'pimcore:run-script'
  const [output, setOutput] = useState('')
  const [status, setStatus] = useState('ready')
  const [exitCode, setExitCode] = useState<number>()
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const controller = useRef<AbortController>()
  const terminal = useRef<HTMLPreElement>(null)
  const command = commands.find(item => item.name === selected)

  useEffect(() => {
    onDraftChange({ command: selected, tokens, phpCode: inlineScript ? phpCode : null, csrfToken })
  }, [selected, tokens, phpCode, inlineScript, csrfToken, onDraftChange])

  useEffect(() => {
    const abort = new AbortController()
    void fetch(commandCenterUrl('list'), { signal: abort.signal }).then(async response => {
      if (!response.ok) throw new Error(t('command-center.error.command-list', { status: response.status }))
      const data = await response.json() as { commands: Definition[], csrfToken: string }
      setCommands(data.commands)
      setCsrfToken(data.csrfToken)
    }).catch((reason: Error) => { if (!abort.signal.aborted) setError(reason.message) })
    return () => { abort.abort(); controller.current?.abort() }
  }, [])

  useEffect(() => {
    terminal.current?.scrollTo(0, terminal.current.scrollHeight)
  }, [output])

  const run = async (): Promise<void> => {
    setError('')
    let args: unknown
    try {
      args = JSON.parse(tokens)
      if (!Array.isArray(args) || !args.every(value => typeof value === 'string')) throw new Error()
    } catch {
      setError(t('command-center.error.arguments'))
      return
    }
    const abort = new AbortController()
    controller.current = abort
    setRunning(true)
    setOutput('')
    setStatus('running-progress')
    let completed = false
    try {
      const response = await fetch(commandCenterUrl('run'), {
        method: 'POST', signal: abort.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: selected, tokens: args, csrfToken, phpCode: inlineScript ? phpCode : null })
      })
      if (!response.ok) throw new Error(t('command-center.error.run', { status: response.status, detail: await response.text() }))
      if (response.body === null) throw new Error(t('command-center.error.stream'))
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let pending = ''
      while (true) {
        const { done, value } = await reader.read()
        pending += decoder.decode(value, { stream: !done })
        const lines = pending.split('\n')
        pending = lines.pop() ?? ''
        for (const line of lines) {
          if (line === '') continue
          const event = JSON.parse(line) as { type: string, text?: string, code?: number }
          if (event.type === 'exit') {
            completed = true
            setExitCode(event.code)
            setStatus('exit')
          } else if (event.type === 'error') {
            throw new Error(event.text)
          } else {
            setOutput(previous => (previous + (event.text ?? '')).slice(-1000000))
          }
        }
        if (done) break
      }
      if (!completed) throw new Error(t('command-center.error.disconnected'))
    } catch (reason) {
      setStatus('interrupted')
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setRunning(false)
      controller.current = undefined
    }
  }

  return (
    <>
      <div style={ { display: 'flex', flexDirection: 'column', gap: 16, height: '100%' } }>
        <Select
          style={ { width: '100%', maxWidth: 'none' } }
          showSearch
          disabled={ running }
          placeholder={t('command-center.ui.choose-command')}
          value={ selected }
          options={ commands.map(item => ({ value: item.name, label: item.name })) }
          onChange={ (value: string) => { setSelected(value); setTokens('[]') } }
        />
        {command !== undefined && (
          <details>
            <summary>{command.description || command.name} – {t('command-center.ui.arguments')}</summary>
            <ul>
              {Object.values(command.definition.arguments).map(arg => (
                <li key={ arg.name }><code>{arg.name}</code>{arg.is_required ? t('command-center.ui.required') : ''}: {arg.description}</li>
              ))}
              {Object.values(command.definition.options).map(option => (
                <li key={ option.name }><code>{option.name}</code>: {option.description}</li>
              ))}
            </ul>
          </details>
        )}
        {inlineScript && (
          <>
            <label htmlFor="command-center-php">{t('command-center.ui.php-code')}</label>
            <TextArea id="command-center-php" value={ phpCode } disabled={ running }
              onChange={ event => setPhpCode(event.target.value) } rows={ 12 }
              spellCheck={ false } style={ { fontFamily: 'monospace' } } />
            <small>{t('command-center.ui.php-help')}</small>
          </>
        )}
        <label htmlFor="command-center-tokens">{inlineScript
          ? t('command-center.ui.inline-options')
          : t('command-center.ui.arguments-json')}</label>
        <TextArea id="command-center-tokens" value={ tokens } disabled={ running }
          onChange={ event => setTokens(event.target.value) } rows={ 3 } />
        <small>{t('command-center.ui.execution-help')}</small>
        <div>
          <Button type="primary" disabled={ selected === undefined || running || (inlineScript && phpCode.trim() === '') } onClick={ () => { void run() } }>{t('command-center.ui.execute')}</Button>
          <span role="status" style={ { marginLeft: 16 } }>{t(`command-center.status.${status}`, { code: exitCode })}</span>
        </div>
        {error !== '' && <div role="alert">{error}</div>}
        <pre ref={ terminal } aria-label={t('command-center.ui.output')} style={ {
          background: '#111827', color: '#e5e7eb', padding: 16, overflow: 'auto',
          whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', minHeight: 240, flex: 1
        } }>{output || t('command-center.ui.no-output')}</pre>
      </div>
    </>
  )
}
