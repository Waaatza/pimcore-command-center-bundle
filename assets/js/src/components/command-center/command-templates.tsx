import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from '@pimcore/studio-ui-bundle/app'
import { Button, Select, TextArea } from '@pimcore/studio-ui-bundle/components'
import { commandCenterUrl } from './api'
import { type CommandDraft } from './scheduled-commands'

interface Field {
  name: string
  label: string
  type: 'string' | 'integer' | 'choice'
  required?: boolean
  default?: string
  choices?: string[]
}
interface Template {
  id?: string
  revision?: number
  label: string
  description: string
  command: string
  tokens: string[]
  fields: Field[]
  previewSupported?: boolean
}
interface Preview {
  supported: boolean
  count?: number
  message?: string
  samples?: Array<{ label: string, before?: string, after?: string }>
}
const blank = (): Template => ({ label: '', description: '', command: '', tokens: [], fields: [] })
const inputStyle = { width: '100%', padding: 8 }

export const CommandTemplates = ({ active, draft }: { active: boolean, draft: CommandDraft }): React.JSX.Element => {
  const { t } = useTranslation()
  const [items, setItems] = useState<Template[]>([])
  const [selected, setSelected] = useState<string>()
  const [values, setValues] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<Preview>()
  const [editor, setEditor] = useState<Template>()
  const [tokens, setTokens] = useState('[]')
  const [commands, setCommands] = useState<string[]>([])
  const [csrfToken, setCsrfToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [deletePending, setDeletePending] = useState(false)
  const controller = useRef<AbortController>()
  const item = items.find(value => value.id === selected)
  useEffect(() => () => { controller.current?.abort() }, [])
  useEffect(() => {
    if (!active) return
    const abort = new AbortController()
    void Promise.all([fetch(commandCenterUrl('templates'), { signal: abort.signal }), fetch(commandCenterUrl('list'), { signal: abort.signal })])
      .then(async ([templatesResponse, catalogResponse]) => {
        if (!templatesResponse.ok || !catalogResponse.ok) throw new Error(`${templatesResponse.status} / ${catalogResponse.status}`)
        const templates = await templatesResponse.json() as { items: Template[] }
        const catalog = await catalogResponse.json() as { commands: Array<{ name: string }>, csrfToken: string }
        if (abort.signal.aborted) return
        setItems(templates.items); setCommands(catalog.commands.map(value => value.name)); setCsrfToken(catalog.csrfToken)
      }).catch((reason: unknown) => { if (!abort.signal.aborted) setError(String(reason)) })
    return () => { abort.abort() }
  }, [active, refresh])
  const post = async (action: string, data: object, signal?: AbortSignal): Promise<Response> => {
    const response = await fetch(commandCenterUrl(`templates/${action}`), { method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, csrfToken }) })
    if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`)
    return response
  }
  const actionData = (): object => ({ id: item?.id, revision: item?.revision, values })
  const perform = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true); setError('')
    try { await action() } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  const edit = (value: Template): void => {
    setEditor({ ...value, fields: value.fields.map(field => ({ ...field })) }); setTokens(JSON.stringify(value.tokens, null, 2)); setDeletePending(false)
  }
  const run = async (): Promise<void> => {
    const abort = new AbortController(); controller.current = abort
    setOutput('')
    try {
      const response = await post('run', actionData(), abort.signal)
      if (response.body === null) throw new Error(t('command-center.error.stream'))
      const reader = response.body.getReader(); const decoder = new TextDecoder()
      let pending = ''; let completed = false
      while (true) {
        const { done, value } = await reader.read()
        pending += decoder.decode(value, { stream: !done })
        const lines = pending.split('\n'); pending = lines.pop() ?? ''
        for (const line of lines) {
          if (line === '') continue
          const event = JSON.parse(line) as { type: string, text?: string, code?: number }
          if (event.type === 'error') throw new Error(event.text)
          if (event.type === 'exit') {
            completed = true
            setOutput(previous => previous + '\n' + t('command-center.status.exit', { code: event.code }))
          } else if (event.text !== undefined) setOutput(previous => (previous + event.text).slice(-1000000))
        }
        if (done) break
      }
      if (!completed) throw new Error(t('command-center.error.disconnected'))
    } finally { controller.current = undefined; setPreview(undefined) }
  }
  const fieldUpdate = (index: number, change: Partial<Field>): void => {
    if (editor !== undefined) setEditor({ ...editor, fields: editor.fields.map((field, at) => at === index ? { ...field, ...change } : field) })
  }
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <p>{t('command-center.templates.help')}</p>
    <div style={{ display: 'flex', gap: 12 }}>
      <Select style={{ flex: 1 }} value={selected} disabled={busy} placeholder={t('command-center.templates.choose')}
        options={items.map(value => ({ value: value.id, label: value.label }))}
        onChange={(id: string) => { setSelected(id); setValues({}); setPreview(undefined); setEditor(undefined); setOutput(''); setDeletePending(false); setError('') }} />
      <Button disabled={busy} onClick={() => edit(blank())}>{t('command-center.templates.new')}</Button>
      <Button disabled={busy || draft.command === undefined || draft.phpCode !== null} onClick={() => {
        try { const args: unknown = JSON.parse(draft.tokens)
          if (!Array.isArray(args) || !args.every(value => typeof value === 'string')) throw new Error(t('command-center.error.arguments'))
          edit({ ...blank(), command: draft.command ?? '', tokens: args as string[] })
        } catch (reason) { setError(String(reason)) }
      }}>{t('command-center.templates.from-draft')}</Button>
      {item !== undefined && <Button disabled={busy} onClick={() => edit(item)}>{t('command-center.templates.edit')}</Button>}
    </div>
    {error !== '' && <p role="alert">{error}</p>}
    {editor !== undefined ? <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label>{t('command-center.templates.label')}<input style={inputStyle} value={editor.label} disabled={busy} onChange={event => setEditor({ ...editor, label: event.target.value })} /></label>
      <label>{t('command-center.templates.description')}<TextArea value={editor.description} disabled={busy} onChange={event => setEditor({ ...editor, description: event.target.value })} /></label>
      <label>{t('command-center.history.command')}<Select style={{ width: '100%' }} showSearch value={editor.command || undefined} disabled={busy}
        options={commands.map(name => ({ value: name, label: name }))} onChange={(command: string) => setEditor({ ...editor, command })} /></label>
      <label>{t('command-center.ui.arguments-json')}<TextArea value={tokens} rows={3} disabled={busy} onChange={event => setTokens(event.target.value)} /></label>
      <small>{t('command-center.templates.placeholder-help').replaceAll('{folder}', '{{folder}}')}</small>
      <h3>{t('command-center.templates.fields')}</h3>
      {editor.fields.map((field, index) => <fieldset key={index} disabled={busy} style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        <label>{t('command-center.templates.field-name')}<input style={inputStyle} value={field.name} onChange={event => fieldUpdate(index, { name: event.target.value })} /></label>
        <label>{t('command-center.templates.label')}<input style={inputStyle} value={field.label} onChange={event => fieldUpdate(index, { label: event.target.value })} /></label>
        <label>{t('command-center.templates.type')}<select style={inputStyle} value={field.type} onChange={event => fieldUpdate(index, { type: event.target.value as Field['type'] })}>
          {['string', 'integer', 'choice'].map(type => <option key={type} value={type}>{t(`command-center.templates.type.${type}`)}</option>)}
        </select></label>
        <label>{t('command-center.templates.default')}<input style={inputStyle} value={field.default ?? ''} onChange={event => fieldUpdate(index, { default: event.target.value })} /></label>
        {field.type === 'choice' && <label>{t('command-center.templates.choices')}<TextArea value={(field.choices ?? []).join('\n')} onChange={event => fieldUpdate(index, { choices: event.target.value.split('\n') })} /></label>}
        <label><input type="checkbox" checked={field.required ?? false} onChange={event => fieldUpdate(index, { required: event.target.checked })} /> {t('command-center.templates.required')}</label>
        <Button onClick={() => setEditor({ ...editor, fields: editor.fields.filter((_, at) => at !== index) })}>{t('command-center.templates.remove-field')}</Button>
      </fieldset>)}
      <div style={{ display: 'flex', gap: 12 }}>
        <Button disabled={busy || editor.fields.length >= 30} onClick={() => setEditor({ ...editor, fields: [...editor.fields, { name: '', label: '', type: 'string', required: true }] })}>{t('command-center.templates.add-field')}</Button>
        <Button type="primary" disabled={busy || editor.label.trim() === '' || editor.command === ''} onClick={() => { void perform(async () => {
          const parsed: unknown = JSON.parse(tokens)
          if (!Array.isArray(parsed) || !parsed.every(value => typeof value === 'string')) throw new Error(t('command-center.error.arguments'))
          const response = await post('save', { id: editor.id ?? null, revision: editor.revision ?? null, label: editor.label, description: editor.description, command: editor.command, tokens: parsed, fields: editor.fields })
          const saved = await response.json() as Template
          setSelected(saved.id); setValues({}); setPreview(undefined); setEditor(undefined); setRefresh(value => value + 1)
        }) } }>{t('command-center.templates.save')}</Button>
        <Button disabled={busy} onClick={() => setEditor(undefined)}>{t('command-center.templates.cancel')}</Button>
      </div>
    </div> : item !== undefined && <>
      <h3>{item.label}</h3><p>{item.description}</p><code>{item.command}</code>
      {item.fields.map(field => <label key={field.name}>{field.label}{field.required === true ? ' *' : ''}
        {field.type === 'choice' ? <select disabled={busy} style={inputStyle} value={values[field.name] ?? field.default ?? ''} onChange={event => { setValues({ ...values, [field.name]: event.target.value }); setPreview(undefined) }}>
          <option value="">{t('command-center.templates.choose-value')}</option>
          {field.choices?.map(choice => <option key={choice} value={choice}>{choice}</option>)}
        </select> : <input disabled={busy} style={inputStyle} type={field.type === 'integer' ? 'number' : 'text'} value={values[field.name] ?? field.default ?? ''}
          onChange={event => { setValues({ ...values, [field.name]: event.target.value }); setPreview(undefined) }} />}
      </label>)}
      <div style={{ display: 'flex', gap: 12 }}>
        <Button disabled={busy || item.previewSupported !== true} onClick={() => { void perform(async () => {
          const response = await post('preview', actionData()); setPreview(await response.json() as Preview)
        }) }}>{t('command-center.templates.preview')}</Button>
        <Button type="primary" disabled={busy || (item.previewSupported === true && preview?.supported !== true)} onClick={() => { void perform(run) }}>{t('command-center.ui.execute')}</Button>
        <Button disabled={busy} onClick={() => setDeletePending(true)}>{t('command-center.templates.delete')}</Button>
      </div>
      {item.previewSupported !== true && <p>{t('command-center.templates.no-preview')}</p>}
      {preview?.supported === true && <section>
        <h3>{t('command-center.templates.preview-count', { count: preview.count })}</h3>
        <p>{preview.message}</p><p>{t('command-center.templates.preview-help')}</p>
        <ul>{preview.samples?.map((sample, index) => <li key={index}><strong>{sample.label}</strong> {sample.before} {sample.after === undefined ? '' : `→ ${sample.after}`}</li>)}</ul>
      </section>}
      {deletePending && <div role="alert"><p>{t('command-center.templates.delete-confirm')}</p>
        <Button disabled={busy} onClick={() => { void perform(async () => { await post('delete', actionData()); setSelected(undefined); setDeletePending(false); setRefresh(value => value + 1) }) }}>{t('command-center.templates.delete')}</Button>
        <Button disabled={busy} onClick={() => setDeletePending(false)}>{t('command-center.templates.cancel')}</Button>
      </div>}
    </>}
    {busy && <p role="status">{t('command-center.status.running-progress')}</p>}
    {output !== '' && <pre style={{ background: '#111827', color: '#e5e7eb', padding: 16, maxHeight: 500, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{output}</pre>}
  </div>
}
