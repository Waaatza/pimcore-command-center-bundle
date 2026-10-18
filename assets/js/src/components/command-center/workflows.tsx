import React, { useEffect, useState } from 'react'
import { useTranslation } from '@pimcore/studio-ui-bundle/app'
import { Button, Input, Select, TextArea } from '@pimcore/studio-ui-bundle/components'
import { commandCenterUrl } from './api'
import { type CommandDraft } from './scheduled-commands'
import { NotificationFields, type Recipient } from './notification-fields'
import { WorkflowRunView } from './workflow-run'

interface Step { label: string, command: string, tokens: string[], phpCode: string | null }
interface Workflow { id: string, revision: number, label: string, description: string, steps: Step[] }
interface EditableStep { label: string, command: string, tokens: string, phpCode: string | null }
interface Editor { id?: string, revision?: number, label: string, description: string, steps: EditableStep[] }
const emptyStep = (): EditableStep => ({ label: '', command: '', tokens: '[]', phpCode: null })

export const Workflows = ({ active, draft, onScheduled }: {
  active: boolean, draft: CommandDraft, onScheduled: () => void
}): React.JSX.Element => {
  const { t } = useTranslation()
  const [items, setItems] = useState<Workflow[]>([])
  const [commands, setCommands] = useState<string[]>([])
  const [csrfToken, setCsrfToken] = useState('')
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [selected, setSelected] = useState<string>()
  const [editor, setEditor] = useState<Editor>()
  const [runId, setRunId] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [deleting, setDeleting] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [runAt, setRunAt] = useState('')
  const [repeat, setRepeat] = useState('once')
  const [recipientIds, setRecipientIds] = useState<number[]>([])
  const [channels, setChannels] = useState<string[]>([])
  const item = items.find(value => value.id === selected)
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  useEffect(() => {
    if (!active) return
    const abort = new AbortController()
    void Promise.all(['workflows', 'list', 'schedules'].map(async path => {
      const response = await fetch(commandCenterUrl(path), { signal: abort.signal })
      if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`)
      return await response.json() as unknown
    })).then(([definitions, catalog, schedules]) => {
      if (abort.signal.aborted) return
      setItems((definitions as { items: Workflow[] }).items)
      const data = catalog as { commands: Array<{ name: string }>, csrfToken: string }
      setCommands(data.commands.map(value => value.name)); setCsrfToken(data.csrfToken)
      setRecipients((schedules as { recipients: Recipient[] }).recipients)
    }).catch((reason: unknown) => { if (!abort.signal.aborted) setError(String(reason)) })
    return () => abort.abort()
  }, [active, refresh])
  const post = async (path: string, data: object): Promise<Response> => {
    const response = await fetch(commandCenterUrl(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, csrfToken }) })
    if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`)
    return response
  }
  const perform = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true); setError('')
    try { await action() } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  const updateStep = (index: number, change: Partial<EditableStep>): void => {
    if (editor !== undefined) setEditor({ ...editor, steps: editor.steps.map((step, at) => at === index ? { ...step, ...change } : step) })
  }
  const moveStep = (index: number, offset: number): void => {
    if (editor === undefined) return
    const steps = [...editor.steps]
    ;[steps[index], steps[index + offset]] = [steps[index + offset], steps[index]]
    setEditor({ ...editor, steps })
  }
  const edit = (workflow?: Workflow): void => {
    setDeleting(false); setScheduling(false)
    setEditor(workflow === undefined ? { label: '', description: '', steps: [emptyStep()] } :
      { ...workflow, steps: workflow.steps.map(step => ({ ...step, tokens: JSON.stringify(step.tokens, null, 2) })) })
  }
  const save = async (): Promise<void> => {
    if (editor === undefined) return
    const steps = editor.steps.map(step => {
      const tokens: unknown = JSON.parse(step.tokens)
      if (!Array.isArray(tokens) || !tokens.every(value => typeof value === 'string')) throw new Error(t('command-center.error.arguments'))
      return { ...step, tokens, phpCode: step.command === 'pimcore:run-script' ? step.phpCode : null }
    })
    const response = await post('workflows/save', { ...editor, id: editor.id ?? null, revision: editor.revision ?? null, steps })
    const saved = await response.json() as Workflow
    setSelected(saved.id); setEditor(undefined); setRefresh(value => value + 1)
  }
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <p>{t('command-center.workflows.help')}</p>
    <div style={{ display: 'flex', gap: 12 }}>
      <Select disabled={busy} style={{ flex: 1 }} placeholder={t('command-center.workflows.choose')} value={selected}
        options={items.map(value => ({ value: value.id, label: value.label }))} onChange={(id: string) => {
          setSelected(id); setEditor(undefined); setDeleting(false); setScheduling(false); setRunId(undefined); setError('')
        }} />
      <Button disabled={busy} onClick={() => edit()}>{t('command-center.workflows.new')}</Button>
      {item !== undefined && <Button disabled={busy} onClick={() => edit(item)}>{t('command-center.workflows.edit')}</Button>}
    </div>
    {error !== '' && <p role="alert">{error}</p>}
    {editor !== undefined ? <fieldset disabled={busy} style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
      <label>{t('command-center.templates.label')}<Input value={editor.label} maxLength={120} onChange={event => setEditor({ ...editor, label: event.target.value })} /></label>
      <label>{t('command-center.templates.description')}<TextArea value={editor.description} onChange={event => setEditor({ ...editor, description: event.target.value })} /></label>
      {editor.steps.map((step, index) => <fieldset key={index} style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <legend>{t('command-center.workflows.step', { number: index + 1 })}</legend>
        <label>{t('command-center.templates.label')}<Input value={step.label} maxLength={120} onChange={event => updateStep(index, { label: event.target.value })} /></label>
        <label>{t('command-center.ui.command')}<Select style={{ width: '100%' }} disabled={busy} showSearch value={step.command || undefined}
          options={commands.map(command => ({ value: command, label: command }))} onChange={(command: string) => updateStep(index, { command, tokens: '[]', phpCode: null })} /></label>
        <label>{t('command-center.ui.arguments-json')}<TextArea value={step.tokens} rows={3} onChange={event => updateStep(index, { tokens: event.target.value })} /></label>
        {step.command === 'pimcore:run-script' && <label>{t('command-center.ui.php-code')}<TextArea rows={8} spellCheck={false} value={step.phpCode ?? ''}
          onChange={event => updateStep(index, { phpCode: event.target.value })} style={{ fontFamily: 'monospace' }} /></label>}
        <div style={{ display: 'flex', gap: 12 }}>
          <Button disabled={busy || index === 0} onClick={() => moveStep(index, -1)}>{t('command-center.workflows.up')}</Button>
          <Button disabled={busy || index === editor.steps.length - 1} onClick={() => moveStep(index, 1)}>{t('command-center.workflows.down')}</Button>
          <Button disabled={busy || editor.steps.length === 1} onClick={() => setEditor({ ...editor, steps: editor.steps.filter((_, at) => at !== index) })}>{t('command-center.workflows.remove')}</Button>
        </div>
      </fieldset>)}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Button disabled={busy || editor.steps.length >= 20} onClick={() => setEditor({ ...editor, steps: [...editor.steps, emptyStep()] })}>{t('command-center.workflows.add')}</Button>
        <Button disabled={busy || editor.steps.length >= 20 || draft.command === undefined} onClick={() => {
          const step = { label: draft.command ?? '', command: draft.command ?? '', tokens: draft.tokens, phpCode: draft.phpCode }
          const steps = editor.steps.length === 1 && editor.steps[0].command === '' ? [step] : [...editor.steps, step]
          setEditor({ ...editor, steps })
        }}>{t('command-center.workflows.from-draft')}</Button>
        <Button type="primary" disabled={busy || editor.label.trim() === '' || editor.steps.some(step => step.command === '' || step.label.trim() === '')} onClick={() => { void perform(save) }}>{t('command-center.workflows.save')}</Button>
        <Button disabled={busy} onClick={() => setEditor(undefined)}>{t('command-center.templates.cancel')}</Button>
      </div>
    </fieldset> : item !== undefined && <>
      <h3>{item.label}</h3><p>{item.description}</p>
      <ol>{item.steps.map((step, index) => <li key={index} style={{ padding: 8 }}>{step.label} · <code>{step.command}</code></li>)}</ol>
      <div style={{ display: 'flex', gap: 12 }}>
        <Button type="primary" disabled={busy} onClick={() => { void perform(async () => {
          const response = await post('workflows/run', { id: item.id, revision: item.revision })
          const run = await response.json() as { id: string }; setRunId(run.id)
        }) }}>{t('command-center.workflows.run')}</Button>
        <Button disabled={busy} onClick={() => { setScheduling(true); setDeleting(false) }}>{t('command-center.workflows.schedule')}</Button>
        <Button disabled={busy} onClick={() => { setDeleting(true); setScheduling(false) }}>{t('command-center.workflows.delete')}</Button>
      </div>
      {deleting && <div role="alert"><p>{t('command-center.workflows.delete-confirm')}</p>
        <Button disabled={busy} onClick={() => { void perform(async () => {
          await post('workflows/delete', { id: item.id, revision: item.revision }); setSelected(undefined); setDeleting(false); setRefresh(value => value + 1)
        }) }}>{t('command-center.workflows.delete')}</Button>
        <Button disabled={busy} onClick={() => setDeleting(false)}>{t('command-center.templates.cancel')}</Button>
      </div>}
      {scheduling && <fieldset disabled={busy} style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <legend>{t('command-center.workflows.schedule')}</legend>
        <p>{t('command-center.workflows.snapshot-help')}</p>
        <label>{t('command-center.ui.first-at', { timezone, interpolation: { escapeValue: false } })}<Input type="datetime-local" value={runAt} onChange={event => setRunAt(event.target.value)} /></label>
        <Select style={{ width: '100%' }} disabled={busy} value={repeat} options={['once', 'hourly', 'daily', 'weekly'].map(value => ({ value, label: t(`command-center.repeat.${value}`) }))} onChange={(value: string) => setRepeat(value)} />
        <NotificationFields recipients={recipients} ids={recipientIds} channels={channels} onIds={setRecipientIds} onChannels={setChannels} />
        <div><Button type="primary" disabled={busy || runAt === ''} onClick={() => { void perform(async () => {
          if (new Date(runAt).getTime() <= Date.now()) throw new Error(t('command-center.error.future-date'))
          await post('schedules/create', { label: item.label, runAt: new Date(runAt).toISOString(), repeat, timezone,
            notificationRecipientIds: recipientIds, notificationChannels: channels,
            execution: { command: item.steps[0].command, tokens: item.steps[0].tokens, phpCode: item.steps[0].phpCode, csrfToken }, workflow: { id: item.id, revision: item.revision } })
          setScheduling(false); onScheduled()
        }) }}>{t('command-center.ui.save-schedule')}</Button>{' '}
        <Button disabled={busy} onClick={() => setScheduling(false)}>{t('command-center.templates.cancel')}</Button></div>
      </fieldset>}
    </>}
    {runId !== undefined && <WorkflowRunView id={runId} active={active} />}
  </div>
}
