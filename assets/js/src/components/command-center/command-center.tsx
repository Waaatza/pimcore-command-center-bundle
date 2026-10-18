import { useTranslation } from '@pimcore/studio-ui-bundle/app'
import { commandCenterUrl } from './api'
import { Output } from './output'
import React, { useEffect, useRef, useState } from 'react'
import { Alert, Button, Collapse, Content, Flex, Form, FormKit, Select, Tabs, Text, TextArea, Title } from '@pimcore/studio-ui-bundle/components'

import { Workflows } from './workflows'
import { InteractiveTerminal } from './interactive-terminal'
import { CommandTemplates } from './command-templates'
import { RunHistory } from './run-history'
import { ScheduledCommands, type CommandDraft } from './scheduled-commands'

interface Definition {
  name: string
  description: string
  definition: {
    arguments: Record<string, { name: string, description: string, is_required: boolean }>
    options: Record<string, { name: string, description: string }>
  }
}

const defaultPhpCode = '<?php\n\necho "Hello from Pimcore!\\n";\n'

export const CommandCenter = (): React.JSX.Element => {
  const { t } = useTranslation()
  const [tab, setTab] = useState('direct')
  const [draft, setDraft] = useState<CommandDraft>({ tokens: '[]', phpCode: null, csrfToken: '' })

  return (
    <Content padded padding="large">
      <Title level={ 2 }>{t('command-center.ui.title')}</Title>
      <Tabs activeKey={ tab } onChange={ setTab } noPadding items={ [
        { key: 'direct', label: t('command-center.tabs.direct'), children: <CommandRunner onDraftChange={ setDraft } /> },
        { key: 'workflows', label: t('command-center.tabs.workflows'), children: <Workflows active={tab === 'workflows'} draft={draft} onScheduled={() => setTab('scheduled')} /> },
        { key: 'templates', label: t('command-center.tabs.templates'), children: <CommandTemplates active={tab === 'templates'} draft={draft} /> },
        { key: 'history', label: t('command-center.tabs.history'), children: <RunHistory active={tab === 'history'} /> },
        { key: 'terminal', label: t('command-center.tabs.terminal'), forceRender: true, children: <InteractiveTerminal active={tab === 'terminal'} csrfToken={draft.csrfToken} /> },
        { key: 'scheduled', label: t('command-center.tabs.scheduled'), children:
          <ScheduledCommands draft={ draft } active={ tab === 'scheduled' } onEdit={ () => setTab('direct') } /> }
      ] } />
    </Content>
  )
}

interface RunnerValues {
  tokens: string
  phpCode: string
}

const CommandRunner = ({ onDraftChange }: { onDraftChange: (draft: CommandDraft) => void }): React.JSX.Element => {
  const { t } = useTranslation()
  const [form] = Form.useForm<RunnerValues>()
  const [selected, setSelected] = useState<string>()
  const tokens = Form.useWatch('tokens', form) ?? '[]'
  const phpCode = Form.useWatch('phpCode', form) ?? ''
  const inlineScript = selected === 'pimcore:run-script'
  const [csrfToken, setCsrfToken] = useState('')
  const [commands, setCommands] = useState<Definition[]>([])
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

  const argumentItems = command === undefined ? [] : [
    ...Object.values(command.definition.arguments).map(arg => (
      <li key={ arg.name }><Text code>{arg.name}</Text>{arg.is_required ? t('command-center.ui.required') : ''}: {arg.description}</li>
    )),
    ...Object.values(command.definition.options).map(option => (
      <li key={ option.name }><Text code>{option.name}</Text>: {option.description}</li>
    ))
  ]

  return (
    <FormKit wrapInPanel={ false } formProps={ {
      form, disabled: running, initialValues: { tokens: '[]', phpCode: defaultPhpCode }
    } }>
      <Flex vertical gap={ 16 } style={ { height: '100%' } }>
        <Select
          style={ { width: '100%', maxWidth: 'none' } }
          showSearch
          disabled={ running }
          placeholder={ t('command-center.ui.choose-command') }
          value={ selected }
          options={ commands.map(item => ({ value: item.name, label: item.name })) }
          onChange={ (value: string) => { setSelected(value); form.setFieldValue('tokens', '[]') } }
        />
        {command !== undefined && (
          <Collapse items={ [{
            key: 'arguments',
            label: `${command.description || command.name} – ${t('command-center.ui.arguments')}`,
            children: <ul>{argumentItems}</ul>
          }] } />
        )}
        {inlineScript && (
          <Form.Item label={ t('command-center.ui.php-code') } name="phpCode">
            <TextArea rows={ 12 } spellCheck={ false } />
          </Form.Item>
        )}
        {inlineScript && <Text type="secondary">{t('command-center.ui.php-help')}</Text>}
        <Form.Item name="tokens" label={ inlineScript
          ? t('command-center.ui.inline-options')
          : t('command-center.ui.arguments-json') }>
          <TextArea rows={ 3 } />
        </Form.Item>
        <Text type="secondary">{t('command-center.ui.execution-help')}</Text>
        <Flex align="center" gap={ 16 }>
          <Button type="primary" disabled={ selected === undefined || running || (inlineScript && phpCode.trim() === '') } onClick={ () => { void run() } }>{t('command-center.ui.execute')}</Button>
          <Text role="status">{t(`command-center.status.${status}`, { code: exitCode })}</Text>
        </Flex>
        {error !== '' && <Alert type="error" message={ error } />}
        <Output ref={ terminal } text={ output } label={ t('command-center.ui.output') } minHeight={ 240 } grow />
      </Flex>
    </FormKit>
  )
}
