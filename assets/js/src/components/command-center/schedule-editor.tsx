import { useTranslation } from '@pimcore/studio-ui-bundle/app'
import React, { useEffect, useState } from 'react'
import { Alert, Button, Flex, Form, FormKit, Input, Select, Text, TextArea } from '@pimcore/studio-ui-bundle/components'
import { commandCenterUrl } from './api'
import { type PlannedCommand } from './scheduled-commands'
import { NotificationFields, type Recipient } from './notification-fields'

const localDate = (value: string | null): string => {
  if (value === null) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export const ScheduleEditor = ({ item, recipients, csrfToken, onSaved, onCancel }: {
  item: PlannedCommand, recipients: Recipient[], csrfToken: string,
  onSaved: (updated: PlannedCommand) => void, onCancel: () => void
}): React.JSX.Element => {
  const { t } = useTranslation()
  const [label, setLabel] = useState(item.label)
  const [command, setCommand] = useState(item.command)
  const [tokens, setTokens] = useState(JSON.stringify(item.tokens ?? []))
  const [phpCode, setPhpCode] = useState(item.phpCode ?? '')
  const [runAt, setRunAt] = useState(localDate(item.nextRunAt))
  const [repeat, setRepeat] = useState<string>(item.repeat)
  const [enabled, setEnabled] = useState(item.enabled)
  const [ids, setIds] = useState(item.notificationRecipientIds ?? [])
  const [channels, setChannels] = useState(item.notificationChannels ?? [])
  const [revision] = useState(item.revision ?? 0)
  const [commands, setCommands] = useState<Array<{ name: string }>>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const running = item.lastRun?.status === 'running'
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const locked = item.workflow !== undefined

  useEffect(() => {
    const abort = new AbortController()
    void fetch(commandCenterUrl('list'), { signal: abort.signal }).then(async response => {
      if (!response.ok) throw new Error(t('command-center.error.commands', { status: response.status }))
      const data = await response.json() as { commands: Array<{ name: string }> }
      if (!abort.signal.aborted) setCommands(data.commands)
    }).catch((reason: Error) => { if (!abort.signal.aborted) setError(reason.message) })
    return () => abort.abort()
  }, [])

  const save = async (): Promise<void> => {
    setError('')
    setBusy(true)
    try {
      const args: unknown = JSON.parse(tokens)
      if (!Array.isArray(args) || !args.every(value => typeof value === 'string')) {
        throw new Error(t('command-center.error.arguments'))
      }
      if (runAt === '' || new Date(runAt).getTime() <= Date.now()) throw new Error(t('command-center.error.future-date'))
      if (command === 'pimcore:run-script' && phpCode.trim() === '') throw new Error(t('command-center.error.php-required'))
      const response = await fetch(commandCenterUrl('schedules/update'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, revision, enabled, schedule: {
          label, runAt: new Date(runAt).toISOString(), repeat, timezone: item.timezone,
          notificationRecipientIds: ids, notificationChannels: channels,
          execution: { command, tokens: args, phpCode: command === 'pimcore:run-script' ? phpCode : null, csrfToken }
        } })
      })
      if (response.status === 409) throw new Error(t('command-center.error.conflict'))
      if (!response.ok) throw new Error(t('command-center.error.save', { status: response.status, detail: await response.text() }))
      onSaved(await response.json() as PlannedCommand)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  return (
    <FormKit wrapInPanel={ false } formProps={ { disabled: busy } }>
      <FormKit.Panel theme="fieldset" title={ t('command-center.ui.edit-schedule') }>
        <Flex vertical gap={ 12 }>
          <Form.Item label={ t('command-center.ui.name') }>
            <Input value={ label } maxLength={ 120 } onChange={ event => setLabel(event.target.value) } />
          </Form.Item>
          {item.workflow !== undefined && <Text>{t('command-center.workflows.snapshot-help')} <Text strong>{item.workflow.label}</Text></Text>}
          <Form.Item label={ t('command-center.ui.command') }>
            <Select disabled={ locked } showSearch value={ command } style={ { width: '100%', maxWidth: 'none' } }
              options={ commands.map(value => ({ value: value.name, label: value.name })) }
              onChange={ (value: string) => { setCommand(value); setTokens('[]') } } />
          </Form.Item>
          <Form.Item label={ t('command-center.ui.arguments-short') }>
            <TextArea disabled={ locked } value={ tokens } rows={ 3 } onChange={ event => setTokens(event.target.value) } />
          </Form.Item>
          {command === 'pimcore:run-script' && <Form.Item label={ t('command-center.ui.php-code') }>
            <TextArea disabled={ locked } value={ phpCode } rows={ 10 } spellCheck={ false }
              style={ { fontFamily: 'monospace' } } onChange={ event => setPhpCode(event.target.value) } />
          </Form.Item>}
          <Form.Item label={ t('command-center.ui.next-at', { timezone }) }>
            <Input type="datetime-local" value={ runAt } onChange={ event => setRunAt(event.target.value) } />
          </Form.Item>
          <Text type="secondary">{t('command-center.ui.repeat-timezone', { timezone: item.timezone })}</Text>
          <Form.Item label={ t('command-center.ui.repeat') }>
            <Select value={ repeat } style={ { width: '100%', maxWidth: 'none' } }
              options={ [{ value: 'once', label: t('command-center.repeat.once') }, { value: 'hourly', label: t('command-center.repeat.hourly') },
                { value: 'daily', label: t('command-center.repeat.daily') }, { value: 'weekly', label: t('command-center.repeat.weekly') }] }
              onChange={ (value: string) => setRepeat(value) } />
          </Form.Item>
          <Form.Item label={ t('command-center.ui.status') }>
            <Select value={ enabled ? 'enabled' : 'disabled' } style={ { width: '100%', maxWidth: 'none' } }
              options={ [{ value: 'enabled', label: t('command-center.status.active') }, { value: 'disabled', label: t('command-center.status.disabled') }] }
              onChange={ (value: string) => setEnabled(value === 'enabled') } />
          </Form.Item>
          <NotificationFields recipients={ recipients } ids={ ids } channels={ channels } onIds={ setIds } onChannels={ setChannels } />
          {running && <Text role="status">{t('command-center.ui.running-lock')}</Text>}
          {error !== '' && <Alert type="error" message={ error } />}
          <Flex gap={ 8 }>
            <Button type="primary" disabled={ busy || running || label.trim() === '' || runAt === '' }
              onClick={ () => { void save() } }>{t('command-center.ui.save-changes')}</Button>
            <Button disabled={ busy } onClick={ onCancel }>{t('command-center.ui.cancel')}</Button>
          </Flex>
        </Flex>
      </FormKit.Panel>
    </FormKit>
  )
}
