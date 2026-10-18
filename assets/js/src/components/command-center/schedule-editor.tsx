import React, { useEffect, useState } from 'react'
import { Button, Input, Select, TextArea } from '@pimcore/studio-ui-bundle/components'
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

  useEffect(() => {
    const abort = new AbortController()
    void fetch(commandCenterUrl('list'), { signal: abort.signal }).then(async response => {
      if (!response.ok) throw new Error(`Commands konnten nicht geladen werden (${response.status}).`)
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
        throw new Error('Argumente müssen ein JSON-Array aus Strings sein.')
      }
      if (runAt === '' || new Date(runAt).getTime() <= Date.now()) throw new Error('Bitte einen zukünftigen Termin wählen.')
      if (command === 'pimcore:run-script' && phpCode.trim() === '') throw new Error('Bitte PHP-Code eingeben.')
      const response = await fetch(commandCenterUrl('schedules/update'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, revision, enabled, schedule: {
          label, runAt: new Date(runAt).toISOString(), repeat, timezone: item.timezone,
          notificationRecipientIds: ids, notificationChannels: channels,
          execution: { command, tokens: args, phpCode: command === 'pimcore:run-script' ? phpCode : null, csrfToken }
        } })
      })
      if (response.status === 409) throw new Error('Der Zeitplan läuft gerade oder wurde zwischenzeitlich geändert. Bitte abbrechen und erneut öffnen.')
      if (!response.ok) throw new Error(`Speichern fehlgeschlagen (${response.status}): ${await response.text()}`)
      onSaved(await response.json() as PlannedCommand)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  return (
    <fieldset disabled={ busy } style={ { display: 'flex', flexDirection: 'column', gap: 12, padding: 16, border: '1px solid #8886' } }>
      <legend>Zeitplan bearbeiten</legend>
      <label htmlFor="edit-schedule-name">Name</label>
      <Input id="edit-schedule-name" value={ label } maxLength={ 120 } onChange={ event => setLabel(event.target.value) } />
      <label htmlFor="edit-schedule-command">Command</label>
      <Select id="edit-schedule-command" showSearch value={ command } style={ { width: '100%', maxWidth: 'none' } }
        options={ commands.map(value => ({ value: value.name, label: value.name })) }
        onChange={ (value: string) => { setCommand(value); setTokens('[]') } } />
      <label htmlFor="edit-schedule-args">Argumente und Optionen als JSON-Array</label>
      <TextArea id="edit-schedule-args" value={ tokens } rows={ 3 } onChange={ event => setTokens(event.target.value) } />
      {command === 'pimcore:run-script' && <>
        <label htmlFor="edit-schedule-php">PHP-Code</label>
        <TextArea id="edit-schedule-php" value={ phpCode } rows={ 10 } spellCheck={ false }
          style={ { fontFamily: 'monospace' } } onChange={ event => setPhpCode(event.target.value) } />
      </>}
      <label htmlFor="edit-schedule-time">Nächste Ausführung ({timezone})</label>
      <Input id="edit-schedule-time" type="datetime-local" value={ runAt } onChange={ event => setRunAt(event.target.value) } />
      <small>Wiederholungen richten sich nach der gespeicherten Zeitzone {item.timezone}.</small>
      <label htmlFor="edit-schedule-repeat">Wiederholung</label>
      <Select id="edit-schedule-repeat" value={ repeat } style={ { width: '100%', maxWidth: 'none' } }
        options={ [{ value: 'once', label: 'Einmalig' }, { value: 'hourly', label: 'Stündlich' },
          { value: 'daily', label: 'Täglich' }, { value: 'weekly', label: 'Wöchentlich' }] }
        onChange={ (value: string) => setRepeat(value) } />
      <label htmlFor="edit-schedule-enabled">Status</label>
      <Select id="edit-schedule-enabled" value={ enabled ? 'enabled' : 'disabled' } style={ { width: '100%', maxWidth: 'none' } }
        options={ [{ value: 'enabled', label: 'Aktiv' }, { value: 'disabled', label: 'Deaktiviert' }] }
        onChange={ (value: string) => setEnabled(value === 'enabled') } />
      <NotificationFields recipients={ recipients } ids={ ids } channels={ channels } onIds={ setIds } onChannels={ setChannels } />
      {running && <div role="status">Während einer Ausführung kann der Zeitplan nicht geändert werden.</div>}
      {error !== '' && <div role="alert">{error}</div>}
      <div>
        <Button type="primary" disabled={ busy || running || label.trim() === '' || runAt === '' }
          onClick={ () => { void save() } }>Änderungen speichern</Button>
        <Button onClick={ onCancel }>Abbrechen</Button>
      </div>
    </fieldset>
  )
}
