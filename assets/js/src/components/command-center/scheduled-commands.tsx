import { useTranslation } from '@pimcore/studio-ui-bundle/app'
import { commandCenterUrl } from './api'
import { WorkflowRunView, statusColor } from './workflow-run'
import { Output } from './output'
import { ScheduleEditor } from './schedule-editor'
import { NotificationFields, type Recipient } from './notification-fields'
import React, { useEffect, useState } from 'react'
import { Alert, Button, Collapse, Flex, Form, FormKit, Grid, Input, Select, Tag, Text, Title } from '@pimcore/studio-ui-bundle/components'
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'

export interface CommandDraft {
  command?: string
  tokens: string
  phpCode: string | null
  csrfToken: string
}

interface Delivery { userId?: number, channel?: string, status: string, error?: string }
interface RunResult {
  historyId?: string
  status: 'running' | 'success' | 'failed' | 'interrupted'
  startedAt: string
  finishedAt: string | null
  exitCode: number | null
  notifications?: Delivery[]
  output?: string
}
export interface PlannedCommand {
  workflow?: { id: string, revision: number, label: string, steps?: Array<{ label: string, command: string }> }
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

const columnHelper = createColumnHelper<PlannedCommand>()

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

  const scheduleStatus = (item: PlannedCommand): { label: string, color: string } => {
    if (item.lastRun?.status === 'running') return { label: t('command-center.status.executing'), color: 'processing' }
    if (item.enabled) return { label: t('command-center.status.active'), color: 'success' }
    if (item.nextRunAt === null) return { label: t('command-center.status.finished'), color: 'default' }
    return { label: t('command-center.status.disabled'), color: 'default' }
  }

  const columns: ColumnDef<any, any>[] = [
    columnHelper.accessor('label', {
      header: t('command-center.ui.name-command'), size: 220,
      cell: info => <Flex vertical gap={ 0 }>
        <Text>{info.getValue()}</Text>
        <Text code>{info.row.original.workflow?.label ?? info.row.original.command}</Text>
      </Flex>
    }),
    columnHelper.accessor('repeat', {
      header: t('command-center.ui.repeat'), size: 130,
      cell: info => <Flex vertical gap={ 0 }>
        <Text>{repeatLabels[info.getValue() as keyof typeof repeatLabels]}</Text>
        <Text type="secondary">{info.row.original.timezone}</Text>
      </Flex>
    }),
    columnHelper.accessor('nextRunAt', {
      header: t('command-center.ui.next-execution'), size: 180,
      cell: info => formatDate(info.getValue())
    }),
    columnHelper.display({
      id: 'status', header: t('command-center.ui.status'), size: 130,
      cell: info => {
        const value = scheduleStatus(info.row.original)
        return <Tag color={ value.color }>{value.label}</Tag>
      }
    }),
    columnHelper.display({
      id: 'lastResult', header: t('command-center.ui.last-result'), size: 200,
      cell: info => {
        const run = info.row.original.lastRun
        if (run === null) return <Text type="secondary">{t('command-center.ui.not-run')}</Text>
        return <Flex vertical gap={ 0 }>
          <Tag color={ statusColor(run.status) }>{statusLabels[run.status]}</Tag>
          {run.exitCode !== null && <Text type="secondary">{t('command-center.ui.exit-code', { code: run.exitCode })}</Text>}
        </Flex>
      }
    }),
    columnHelper.display({
      id: 'actions', header: t('command-center.ui.actions'), size: 340,
      cell: info => {
        const item = info.row.original
        return <Flex gap={ 8 } wrap>
          <Button disabled={ busy || (!item.enabled && item.nextRunAt === null) }
            onClick={ () => { void action(item, item.enabled ? 'disable' : 'enable') } }>{item.enabled ? t('command-center.ui.disable') : t('command-center.ui.enable')}</Button>
          <Button onClick={ () => { if (selectedId !== item.id) setDetail(undefined); setSelectedId(item.id); setEditingId(undefined) } }>{t('command-center.ui.details')}</Button>
          <Button disabled={ busy || item.lastRun?.status === 'running' } onClick={ () => {
            if (selectedId !== item.id) setDetail(undefined)
            setSelectedId(item.id); setEditingId(item.id)
          } }>{t('command-center.ui.edit')}</Button>
          <Button danger disabled={ busy || item.lastRun?.status === 'running' }
            onClick={ () => { void action(item, 'delete') } }>{t('command-center.ui.delete')}</Button>
        </Flex>
      }
    })
  ]

  return (
    <Flex vertical gap={ 16 }>
      <Text type="secondary">{t('command-center.ui.schedule-help')}</Text>
      <Text type="secondary">{t('command-center.ui.worker', { date: heartbeat === null ? t('command-center.ui.no-heartbeat') : formatDate(heartbeat), interpolation: { escapeValue: false } })}</Text>
      <FormKit wrapInPanel={ false }>
        <FormKit.Panel theme="fieldset" title={ t('command-center.ui.new-schedule') }>
          <Flex vertical gap={ 12 }>
            <Flex align="center" gap={ 8 } wrap>
              <Text>{t('command-center.ui.command')}: <Text strong>{draft.command ?? t('command-center.ui.none-selected')}</Text>{draft.phpCode !== null && t('command-center.ui.with-php')}</Text>
              <Button type="link" onClick={ onEdit }>{t('command-center.ui.edit-command')}</Button>
            </Flex>
            <Text type="secondary">{t('command-center.ui.draft-help')}</Text>
            <Form.Item label={ t('command-center.ui.name') }>
              <Input value={ label } maxLength={ 120 } onChange={ event => setLabel(event.target.value) } />
            </Form.Item>
            <Form.Item label={ t('command-center.ui.first-at', { timezone, interpolation: { escapeValue: false } }) }>
              <Input type="datetime-local" value={ runAt } onChange={ event => setRunAt(event.target.value) } />
            </Form.Item>
            <Form.Item label={ t('command-center.ui.repeat') }>
              <Select value={ repeat } style={ { width: '100%', maxWidth: 'none' } }
                options={ Object.entries(repeatLabels).map(([value, label]) => ({ value, label })) }
                onChange={ (value: string) => setRepeat(value) } />
            </Form.Item>
            <NotificationFields recipients={ recipients } ids={ recipientIds } channels={ channels }
              onIds={ setRecipientIds } onChannels={ setChannels } />
            <Flex>
              <Button type="primary" disabled={ busy || draft.command === undefined || draft.csrfToken === '' || label.trim() === '' || runAt === '' }
                onClick={ () => { void create() } }>{t('command-center.ui.save-schedule')}</Button>
            </Flex>
          </Flex>
        </FormKit.Panel>
      </FormKit>
      {error !== '' && <Alert type="error" message={ error } />}
      {notice !== '' && <Alert type="success" message={ notice } />}
      <Title level={ 3 }>{t('command-center.ui.saved-schedules')}</Title>
      {items.length === 0 && <Text type="secondary">{t('command-center.ui.no-schedules')}</Text>}
      <Grid columns={ columns } data={ items } size="small" />
      {detail !== undefined && (
        <section>
          <Flex vertical gap={ 8 }>
            <Title level={ 3 }>{detail.label}</Title>
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
              <Flex vertical gap={ 4 }>
                {detail.lastRun.notifications.map((delivery, index) => (
                  <Text key={ index }>{delivery.channel === 'email' ? t('command-center.notify.email') : 'Studio'}{t('command-center.ui.user', { id: delivery.userId ?? '—' })}
                    {delivery.status === 'sent' ? t('command-center.notify.sent') : t('command-center.notify.failed', { error: delivery.error ?? '' })}</Text>
                ))}
              </Flex>
            )}
            <Text type="secondary">{t('command-center.ui.last-times', { start: formatDate(detail.lastRun?.startedAt ?? null), end: formatDate(detail.lastRun?.finishedAt ?? null), interpolation: { escapeValue: false } })}</Text>
            <Collapse items={ [{ key: 'parameters', label: t('command-center.ui.saved-parameters'), children:
              <Output text={ `${JSON.stringify(detail.tokens)}\n${detail.phpCode ?? ''}` } label={ t('command-center.ui.saved-parameters') } /> }] } />
            {detail.workflow !== undefined && detail.lastRun?.historyId !== undefined && <WorkflowRunView id={detail.lastRun.historyId} active={active} />}
            <Output text={ detail.lastRun?.output } label={ t('command-center.ui.scheduled-output') } minHeight={ 160 } maxHeight={ 480 } />
          </Flex>
        </section>
      )}
    </Flex>
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
  const [failed, setFailed] = useState(false)
  const save = async (): Promise<void> => {
    setBusy(true)
    setMessage('')
    setFailed(false)
    try {
      const response = await fetch(commandCenterUrl('schedules/notifications'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, csrfToken, notificationRecipientIds: ids, notificationChannels: channels })
      })
      if (!response.ok) throw new Error(t('command-center.error.save', { status: response.status, detail: await response.text() }))
      setMessage(t('command-center.notice.notifications-saved'))
      onSaved()
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); setFailed(true) }
    finally { setBusy(false) }
  }
  return (
    <FormKit wrapInPanel={ false } formProps={ { disabled: busy } }>
      <FormKit.Panel theme="fieldset" title={ t('command-center.notify.settings') }>
        <Flex vertical gap={ 12 }>
          <NotificationFields recipients={ recipients } ids={ ids } channels={ channels }
            onIds={ setIds } onChannels={ setChannels } />
          <Flex><Button disabled={ busy } onClick={ () => { void save() } }>{t('command-center.notify.save')}</Button></Flex>
          {message !== '' && <Alert type={ failed ? 'error' : 'success' } message={ message } />}
        </Flex>
      </FormKit.Panel>
    </FormKit>
  )
}
