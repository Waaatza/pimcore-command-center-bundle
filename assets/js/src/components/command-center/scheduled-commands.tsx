import { useTranslation } from '@pimcore/studio-ui-bundle/app'
import { commandCenterUrl } from './api'
import { ScheduleEditor } from './schedule-editor'
import { NotificationFields, type Recipient } from './notification-fields'
import React, { useEffect, useState } from 'react'
import { Button, Input, Select } from '@pimcore/studio-ui-bundle/components'

export interface CommandDraft {
  command?: string
  tokens: string
  phpCode: string | null
  csrfToken: string
}

interface Delivery { userId?: number, channel?: string, status: string, error?: string }
interface RunResult {
  status: 'running' | 'success' | 'failed' | 'interrupted'
  startedAt: string
  finishedAt: string | null
  exitCode: number | null
  notifications?: Delivery[]
  output?: string
}
export interface PlannedCommand {
  id: string
  revision?: number
  label: string
  command: string
  tokens?: string[]
  phpCode?: string | null
  repeat: 'once' | 'hourly' | 'daily' | 'weekly'
  timezone: string
  nextRunAt: string | null
  enabled: boolean
  notificationRecipientIds?: number[]
  notificationChannels?: string[]
  lastRun: RunResult | null
}



export const ScheduledCommands = ({ draft, active, onEdit }: {
  draft: CommandDraft
  active: boolean
  onEdit: () => void
}): React.JSX.Element => {
  const { t, i18n } = useTranslation()
  const formatDate = (value: string | null): string => value === null ? '—' : new Date(value).toLocaleString(i18n.language)
  const repeatLabels = { once: t('command-center.repeat.once'), hourly: t('command-center.repeat.hourly'), daily: t('command-center.repeat.daily'), weekly: t('command-center.repeat.weekly') }
  const statusLabels = { running: t('command-center.status.running'), success: t('command-center.status.success'), failed: t('command-center.status.failed'), interrupted: t('command-center.status.interrupted') }

  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [recipientIds, setRecipientIds] = useState<number[]>([])
  const [channels, setChannels] = useState<string[]>([])
  const [items, setItems] = useState<PlannedCommand[]>([])
  const [editingId, setEditingId] = useState<string>()
  const [detail, setDetail] = useState<PlannedCommand>()
  const [selectedId, setSelectedId] = useState<string>()
  const [label, setLabel] = useState('')
  const [runAt, setRunAt] = useState('')
  const [repeat, setRepeat] = useState('once')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [heartbeat, setHeartbeat] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  useEffect(() => {
    if (!active) return
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const load = async (): Promise<void> => {
      try {
        const response = await fetch(commandCenterUrl('schedules'), {
          signal: abort.signal, cache: 'no-store'
        })
        if (!response.ok) throw new Error(t('command-center.error.schedules', { status: response.status }))
        const data = await response.json() as { schedules: PlannedCommand[], lastHeartbeat: string | null, recipients: Recipient[] }
        if (abort.signal.aborted) return
        setItems(data.schedules)
        setRecipients(data.recipients)
        setHeartbeat(data.lastHeartbeat)
        if (selectedId !== undefined) {
          const result = await fetch(commandCenterUrl(`schedules/${selectedId}`), {
            signal: abort.signal, cache: 'no-store'
          })
          if (result.status === 404) { setSelectedId(undefined); setDetail(undefined) } else {
            if (!result.ok) throw new Error(t('command-center.error.result', { status: result.status }))
            const selected = await result.json() as PlannedCommand
            if (!abort.signal.aborted) setDetail(selected)
          }
        }
      } catch (reason) {
        if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(() => { void load() }, 5000)
      }
    }
    void load()
    return () => { abort.abort(); clearTimeout(timer) }
  }, [active, selectedId, revision])

  const create = async (): Promise<void> => {
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const tokens: unknown = JSON.parse(draft.tokens)
      if (!Array.isArray(tokens) || !tokens.every(value => typeof value === 'string')) {
        throw new Error(t('command-center.error.arguments'))
      }
      if (runAt === '' || new Date(runAt).getTime() <= Date.now()) throw new Error(t('command-center.error.future-date'))
      const response = await fetch(commandCenterUrl('schedules/create'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label, runAt: new Date(runAt).toISOString(), repeat, timezone,
          notificationRecipientIds: recipientIds, notificationChannels: channels,
          execution: { ...draft, tokens }
        })
      })
      if (!response.ok) throw new Error(t('command-center.error.create', { status: response.status, detail: await response.text() }))
      setNotice(t('command-center.notice.saved'))
      setRevision(value => value + 1)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally { setBusy(false) }
  }

  const action = async (item: PlannedCommand, action: 'enable' | 'disable' | 'delete'): Promise<void> => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(commandCenterUrl('schedules/action'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, action, csrfToken: draft.csrfToken })
      })
      if (!response.ok) throw new Error(t('command-center.error.change', { status: response.status, detail: await response.text() }))
      if (action === 'delete' && item.id === selectedId) { setSelectedId(undefined); setDetail(undefined) }
      setRevision(value => value + 1)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally { setBusy(false) }
  }

  return (
    <div style={ { display: 'flex', flexDirection: 'column', gap: 16 } }>
      <p>{t('command-center.ui.schedule-help')}</p>
      <small>{t('command-center.ui.worker', { date: heartbeat === null ? t('command-center.ui.no-heartbeat') : formatDate(heartbeat), interpolation: { escapeValue: false } })}</small>
      <fieldset style={ { display: 'flex', flexDirection: 'column', gap: 12, padding: 16, border: '1px solid #8886' } }>
        <legend>{t('command-center.ui.new-schedule')}</legend>
        <div>{t('command-center.ui.command')}: <strong>{draft.command ?? t('command-center.ui.none-selected')}</strong>{draft.phpCode !== null && t('command-center.ui.with-php')}
          <Button type="link" onClick={ onEdit }>{t('command-center.ui.edit-command')}</Button>
        </div>
        <small>{t('command-center.ui.draft-help')}</small>
        <label htmlFor="schedule-label">{t('command-center.ui.name')}</label>
        <Input id="schedule-label" value={ label } maxLength={ 120 } onChange={ event => setLabel(event.target.value) } />
        <label htmlFor="schedule-run-at">{t('command-center.ui.first-at', { timezone, interpolation: { escapeValue: false } })}</label>
        <Input id="schedule-run-at" type="datetime-local" value={ runAt } onChange={ event => setRunAt(event.target.value) } />
        <label htmlFor="schedule-repeat">{t('command-center.ui.repeat')}</label>
        <Select id="schedule-repeat" value={ repeat } style={ { width: '100%', maxWidth: 'none' } }
          options={ Object.entries(repeatLabels).map(([value, label]) => ({ value, label })) }
          onChange={ (value: string) => setRepeat(value) } />
        <NotificationFields recipients={ recipients } ids={ recipientIds } channels={ channels }
          onIds={ setRecipientIds } onChannels={ setChannels } />
        <div><Button type="primary" disabled={ busy || draft.command === undefined || draft.csrfToken === '' || label.trim() === '' || runAt === '' }
          onClick={ () => { void create() } }>{t('command-center.ui.save-schedule')}</Button></div>
      </fieldset>
      {error !== '' && <div role="alert">{error}</div>}
      {notice !== '' && <div role="status">{notice}</div>}
      <h3>{t('command-center.ui.saved-schedules')}</h3>
      {items.length === 0 && <p>{t('command-center.ui.no-schedules')}</p>}
      <div style={ { overflowX: 'auto' } }>
        <table style={ { width: '100%', borderCollapse: 'collapse', textAlign: 'left' } }>
          <thead><tr>
            {[t('command-center.ui.name-command'), t('command-center.ui.repeat'), t('command-center.ui.next-execution'), t('command-center.ui.status'), t('command-center.ui.last-result'), t('command-center.ui.actions')].map(text => (
              <th key={ text } style={ { padding: 12 } }>{text}</th>
            ))}
          </tr></thead>
          <tbody>{items.map(item => (
            <tr key={ item.id } style={ { borderTop: '1px solid #8886' } }>
              <td style={ { padding: 12 } }>{item.label}<br /><code>{item.command}</code></td>
              <td style={ { padding: 12 } }>{repeatLabels[item.repeat]}<br /><small>{item.timezone}</small></td>
              <td style={ { padding: 12 } }>{formatDate(item.nextRunAt)}</td>
              <td style={ { padding: 12 } }>{item.lastRun?.status === 'running' ? t('command-center.status.executing') : item.enabled ? t('command-center.status.active') : item.nextRunAt === null ? t('command-center.status.finished') : t('command-center.status.disabled')}</td>
              <td style={ { padding: 12 } }>{item.lastRun === null ? t('command-center.ui.not-run') :
                `${statusLabels[item.lastRun.status]}${item.lastRun.exitCode !== null ? t('command-center.ui.exit-code', { code: item.lastRun.exitCode }) : ''}`}</td>
              <td style={ { padding: 12 } }>
                <Button disabled={ busy || (!item.enabled && item.nextRunAt === null) }
                  onClick={ () => { void action(item, item.enabled ? 'disable' : 'enable') } }>{item.enabled ? t('command-center.ui.disable') : t('command-center.ui.enable')}</Button>
                <Button onClick={ () => { if (selectedId !== item.id) setDetail(undefined); setSelectedId(item.id); setEditingId(undefined) } }>{t('command-center.ui.details')}</Button>
                <Button disabled={ busy || item.lastRun?.status === 'running' } onClick={ () => {
                  if (selectedId !== item.id) setDetail(undefined)
                  setSelectedId(item.id); setEditingId(item.id)
                } }>{t('command-center.ui.edit')}</Button>
                <Button danger disabled={ busy || item.lastRun?.status === 'running' }
                  onClick={ () => { void action(item, 'delete') } }>{t('command-center.ui.delete')}</Button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {detail !== undefined && (
        <section>
          <h3>{detail.label}</h3>
          {editingId === detail.id ? (
            <ScheduleEditor key={ detail.id } item={ detail } recipients={ recipients } csrfToken={ draft.csrfToken }
              onCancel={ () => setEditingId(undefined) }
              onSaved={ updated => {
                setDetail(updated); setEditingId(undefined); setNotice(t('command-center.notice.updated')); setRevision(value => value + 1)
              } } />
          ) : (
            <NotificationEditor key={ detail.id } item={ detail } recipients={ recipients } csrfToken={ draft.csrfToken }
              onSaved={ () => setRevision(value => value + 1) } />
          )}
          {detail.lastRun?.notifications !== undefined && detail.lastRun.notifications.length > 0 && (
            <ul>{detail.lastRun.notifications.map((delivery, index) => (
              <li key={ index }>{delivery.channel === 'email' ? t('command-center.notify.email') : 'Studio'}{t('command-center.ui.user', { id: delivery.userId ?? '—' })}
                {delivery.status === 'sent' ? t('command-center.notify.sent') : t('command-center.notify.failed', { error: delivery.error ?? '' })}</li>
            ))}</ul>
          )}
          <p>{t('command-center.ui.last-times', { start: formatDate(detail.lastRun?.startedAt ?? null), end: formatDate(detail.lastRun?.finishedAt ?? null), interpolation: { escapeValue: false } })}</p>
          <details><summary>{t('command-center.ui.saved-parameters')}</summary>
            <pre style={ { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }>{JSON.stringify(detail.tokens)}{'\n'}{detail.phpCode}</pre>
          </details>
          <pre aria-label={t('command-center.ui.scheduled-output')} style={ {
            background: '#111827', color: '#e5e7eb', padding: 16, overflow: 'auto', maxHeight: 480,
            whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', minHeight: 160
          } }>{detail.lastRun?.output || t('command-center.ui.no-output')}</pre>
        </section>
      )}
    </div>
  )
}



const NotificationEditor = ({ item, recipients, csrfToken, onSaved }: {
  item: PlannedCommand, recipients: Recipient[], csrfToken: string, onSaved: () => void
}): React.JSX.Element => {
  const { t } = useTranslation()
  const [ids, setIds] = useState(item.notificationRecipientIds ?? [])
  const [channels, setChannels] = useState(item.notificationChannels ?? [])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const save = async (): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch(commandCenterUrl('schedules/notifications'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, csrfToken, notificationRecipientIds: ids, notificationChannels: channels })
      })
      if (!response.ok) throw new Error(t('command-center.error.save', { status: response.status, detail: await response.text() }))
      setMessage(t('command-center.notice.notifications-saved'))
      onSaved()
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  return (
    <fieldset style={ { display: 'flex', flexDirection: 'column', gap: 12, padding: 16, border: '1px solid #8886' } }>
      <legend>{t('command-center.notify.settings')}</legend>
      <NotificationFields recipients={ recipients } ids={ ids } channels={ channels }
        onIds={ setIds } onChannels={ setChannels } />
      <div><Button disabled={ busy } onClick={ () => { void save() } }>{t('command-center.notify.save')}</Button></div>
      {message !== '' && <div role="status">{message}</div>}
    </fieldset>
  )
}
