import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from '@pimcore/studio-ui-bundle/app'
import { Alert, Block, Button, Flex, Form, FormKit, Grid, Input, Select, Tag, Text, TextArea, Title, Tooltip, useAlertModal, WindowModal } from '@pimcore/studio-ui-bundle/components'
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { commandCenterUrl } from './api'
import { Output } from './output'
import { tooltipButtonStyle } from './command-templates.styles'
import { InputFieldEditor as TemplateFieldRow, type InputField as Field } from './input-fields'
import { type CommandDraft } from './scheduled-commands'


interface Template {
  id?: string
  revision?: number
  label: string
  description: string
  command: string
  tokens: string[]
  phpCode?: string | null
  fields: Field[]
  previewSupported?: boolean
}
interface Preview {
  supported: boolean
  count?: number
  message?: string
  samples?: Array<{ label: string, before?: string, after?: string }>
}
interface EditorValues {
  fields: Field[]
}
const blank = (): Template => ({ label: '', description: '', command: '', tokens: [], fields: [] })

const columnHelper = createColumnHelper<Template>()


export const CommandTemplates = ({ active, draft }: { active: boolean, draft: CommandDraft }): React.JSX.Element => {
  const { t } = useTranslation()
  const alertModal = useAlertModal()
  const [editorForm] = Form.useForm<EditorValues>()
  const [items, setItems] = useState<Template[]>([])
  const [selected, setSelected] = useState<string>()
  const [values, setValues] = useState<Record<string, string>>({})
  const [previewSnapshot, setPreview] = useState<{ result: Preview, request: string }>()
  const [editor, setEditor] = useState<Template>()
  const [session, setSession] = useState(0)
  const [tokens, setTokens] = useState('[]')
  const [commands, setCommands] = useState<string[]>([])
  const [csrfToken, setCsrfToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const controller = useRef<AbortController>()
  const item = items.find(value => value.id === selected)
  const previewRequest = JSON.stringify({ id: item?.id, revision: item?.revision, values })
  const preview = previewSnapshot?.request === previewRequest ? previewSnapshot.result : undefined
  const watchedFields = Form.useWatch('fields', editorForm) as Field[] | undefined
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
  const actionData = (value: Template): object => ({ id: value.id, revision: value.revision, values })
  const perform = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true); setError('')
    try { await action() } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  const edit = (value: Template): void => {
    setSelected(undefined)
    setEditor({ ...value, fields: value.fields.map(field => ({ ...field })) }); setTokens(JSON.stringify(value.tokens, null, 2)); setSession(current => current + 1)
  }
  const open = (value: Template): void => {
    setSelected(value.id); setValues({}); setPreview(undefined); setEditor(undefined); setOutput(''); setError('')
  }
  const runFromRow = (value: Template): void => {
    open(value)
    void perform(() => run(value))
  }
  const confirmDelete = (value: Template): void => {
    alertModal.warn({
      title: t('command-center.templates.delete'),
      content: t('command-center.templates.delete-confirm'),
      okButtonProps: { danger: true },
      onOk: () => { void perform(async () => {
        await post('delete', { id: value.id, revision: value.revision, values })
        if (selected === value.id) setSelected(undefined)
        setRefresh(current => current + 1)
      }) }
    })
  }
  const run = async (value: Template): Promise<void> => {
    const abort = new AbortController(); controller.current = abort
    setOutput('')
    setPreview(undefined)
    try {
      const response = await post('run', actionData(value), abort.signal)
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
      if (value.previewSupported === true) {
        const updated = await post('preview', actionData(value), abort.signal)
        const result = await updated.json() as Preview
        if (!abort.signal.aborted) setPreview({ result, request: previewRequest })
      }
    } finally { controller.current = undefined }
  }
  const save = (): void => {
    if (editor === undefined) return
    void perform(async () => {
      await new Promise(resolve => { window.setTimeout(resolve, 30) })
      const current = editorForm.getFieldsValue(true) as EditorValues
      const fields = (current.fields ?? []).map(raw => {
        const field: Field = {
          name: raw?.name ?? '', label: raw?.label ?? '', type: raw?.type ?? 'string', required: raw?.required ?? true
        }
        if (raw?.default !== undefined && raw?.default !== null) field.default = raw.default
        if (raw?.choices !== undefined && raw?.choices !== null) field.choices = raw.choices
        return field
      })
      const parsed: unknown = JSON.parse(tokens)
      if (!Array.isArray(parsed) || !parsed.every(value => typeof value === 'string')) throw new Error(t('command-center.error.arguments'))
      const response = await post('save', { id: editor.id ?? null, revision: editor.revision ?? null, label: editor.label, description: editor.description, command: editor.command, phpCode: editor.command === 'pimcore:run-script' ? editor.phpCode || null : null, tokens: parsed, fields })
      const saved = await response.json() as Template
      setSelected(saved.id); setValues({}); setPreview(undefined); setEditor(undefined); setRefresh(value => value + 1)
    })
  }
  const columns: ColumnDef<any, any>[] = [
    columnHelper.accessor('label', {
      header: t('command-center.templates.label'), size: 320, meta: { autoWidth: true },
      cell: info => <Flex vertical gap={ 0 }>
        <Text>{ info.getValue() }</Text>
        <Text code>{ info.row.original.command }</Text>
      </Flex>
    }),
    columnHelper.display({
      id: 'fields', header: t('command-center.templates.fields'), size: 110,
      cell: info => <Text type={ info.row.original.fields.length === 0 ? 'secondary' : undefined }>{ info.row.original.fields.length }</Text>
    }),
    columnHelper.display({
      id: 'preview', header: t('command-center.templates.preview-short'), size: 120,
      cell: info => info.row.original.previewSupported === true
        ? <Tag color="success">{ t('command-center.ui.yes') }</Tag>
        : <Tag>{ t('command-center.ui.no') }</Tag>
    }),
    columnHelper.display({
      id: 'actions', header: t('command-center.ui.actions'), size: 420,
      cell: info => {
        const value = info.row.original
        const runHint = value.previewSupported === true
          ? t('command-center.templates.run-preview-hint')
          : (value.fields.length > 0 ? t('command-center.templates.run-fields-hint') : undefined)
        return <Flex gap={ 8 } wrap align="center">
          <Tooltip title={ runHint }>
            <span style={ tooltipButtonStyle }>
              <Button type="primary" disabled={ busy || runHint !== undefined }
                onClick={() => runFromRow(value) }>{t('command-center.ui.execute')}</Button>
            </span>
          </Tooltip>
          <Button disabled={ busy } onClick={() => open(value) }>{t('command-center.ui.details')}</Button>
          <Button disabled={ busy } onClick={() => edit(value) }>{t('command-center.ui.edit')}</Button>
          <Button danger disabled={ busy } onClick={() => confirmDelete(value) }>{t('command-center.ui.delete')}</Button>
        </Flex>
      }
    })
  ]
  const closeDetails = (): void => { setSelected(undefined) }
  return <Flex vertical gap={ 16 }>
    <Text type="secondary">{t('command-center.templates.help')}</Text>
    <Flex gap={ 12 } justify="flex-end">
      <Button disabled={busy} onClick={() => edit(blank())}>{t('command-center.templates.new')}</Button>
      <Button disabled={busy || draft.command === undefined} onClick={() => {
        try { const args: unknown = JSON.parse(draft.tokens)
          if (!Array.isArray(args) || !args.every(value => typeof value === 'string')) throw new Error(t('command-center.error.arguments'))
          edit({ ...blank(), command: draft.command ?? '', tokens: args as string[], phpCode: draft.phpCode })
        } catch (reason) { setError(String(reason)) }
      }}>{t('command-center.templates.from-draft')}</Button>
    </Flex>
    {error !== '' && editor === undefined && item === undefined && <Alert type="error" message={ error } />}
    {items.length === 0 && <Text type="secondary">{t('command-center.templates.empty')}</Text>}
    <Grid autoWidth columns={ columns } data={ items } size="small" />
    {busy && <Text role="status">{t('command-center.status.running-progress')}</Text>}
    {editor !== undefined && <WindowModal open={ active } size="L" limitContentHeight
      title={ editor.id === undefined ? t('command-center.templates.new') : t('command-center.templates.edit') }
      onCancel={ () => { if (!busy) setEditor(undefined) } }
      footer={ <Flex gap={ 12 } justify="flex-end">
        <Button disabled={ busy } onClick={() => setEditor(undefined)}>{t('command-center.templates.cancel')}</Button>
        <Button type="primary" disabled={busy || editor.label.trim() === '' || editor.command === ''} onClick={ save }>{t('command-center.templates.save')}</Button>
      </Flex> }>
      {error !== '' && <Alert type="error" message={ error } />}
      <FormKit key={ session } wrapInPanel={ false } formProps={ { form: editorForm, disabled: busy, initialValues: { fields: editor.fields } } }>
        <Flex vertical gap={ 12 }>
          <Form.Item label={ t('command-center.templates.label') }>
            <Input value={editor.label} onChange={event => setEditor({ ...editor, label: event.target.value })} />
          </Form.Item>
          <Form.Item label={ t('command-center.templates.description') }>
            <TextArea value={editor.description} onChange={event => setEditor({ ...editor, description: event.target.value })} />
          </Form.Item>
          <Form.Item label={ t('command-center.history.command') }>
            <Select style={ { width: '100%', maxWidth: 'none' } } showSearch value={editor.command || undefined}
              popupMatchSelectWidth={ false }
              options={commands.map(name => ({ value: name, label: name }))} onChange={(command: string) => setEditor({ ...editor, command, phpCode: null })} />
          </Form.Item>
          <Form.Item label={ t('command-center.ui.arguments-json') }>
            <TextArea value={ tokens } rows={ 3 } onChange={ event => setTokens(event.target.value) } />
          </Form.Item>
          {editor.command === 'pimcore:run-script' && <Form.Item label={t('command-center.ui.php-code')}>
            <TextArea value={editor.phpCode ?? ''} rows={8} spellCheck={false} style={{ fontFamily: 'monospace' }}
              onChange={event => setEditor({ ...editor, phpCode: event.target.value })} />
          </Form.Item>}
          <Text type="secondary">{t('command-center.templates.placeholder-help').replaceAll('{folder}', '{{folder}}')}</Text>
          <Form.Item label={ t('command-center.templates.fields') } name="fields">
            <Block border maxItems={ 30 } noteditable={ busy }
              getItemTitle={ (itemValue: Field | undefined, index) => itemValue?.label || itemValue?.name || `#${index + 1}` }>
              { ({ blockIndex }) => <TemplateFieldRow field={ watchedFields?.[blockIndex] } /> }
            </Block>
          </Form.Item>
        </Flex>
      </FormKit>
    </WindowModal>}
    {item !== undefined && <WindowModal open={ active } size="L" limitContentHeight title={ t('command-center.ui.details') }
      onCancel={ () => { if (!busy) closeDetails() } }
      footer={ <Button disabled={ busy } onClick={ closeDetails }>{t('command-center.actions.close')}</Button> }>
      {error !== '' && <Alert type="error" message={ error } />}
      <FormKit wrapInPanel={ false } formProps={ { disabled: busy } }>
        <Flex vertical gap={ 8 }>
          <Title level={ 3 }>{item.label}</Title>
          <Text>{item.description}</Text>
          <Text code>{item.command}</Text>
          {item.fields.map(field => (
            <Form.Item key={ field.name } label={ `${field.label}${field.required === true ? ' *' : ''}` }>
              {field.type === 'choice' ? (
                <Select style={ { width: '100%', maxWidth: 'none' } } value={values[field.name] ?? field.default ?? ''}
                  popupMatchSelectWidth={ false }
                  options={ (field.choices ?? []).map(choice => ({ value: choice, label: choice })) }
                  placeholder={ t('command-center.templates.choose-value') }
                  onChange={(value: string) => { setValues({ ...values, [field.name]: value }); setPreview(undefined) }} />
              ) : (
                <Input type={ field.type === 'integer' ? 'number' : 'text' } value={values[field.name] ?? field.default ?? ''}
                  onChange={event => { setValues({ ...values, [field.name]: event.target.value }); setPreview(undefined) }} />
              )}
            </Form.Item>
          ))}
          <Flex gap={ 12 }>
            <Button disabled={busy || item.previewSupported !== true} onClick={() => { void perform(async () => {
              const response = await post('preview', actionData(item))
              setPreview({ result: await response.json() as Preview, request: previewRequest })
            }) }}>{t('command-center.templates.preview')}</Button>
            <Button type="primary" disabled={busy || (item.previewSupported === true && preview?.supported !== true)} onClick={() => { void perform(() => run(item)) }}>{t('command-center.ui.execute')}</Button>
          </Flex>
          {item.previewSupported !== true && <Text type="secondary">{t('command-center.templates.no-preview')}</Text>}
          {preview?.supported === true && (
            <Flex vertical gap={ 8 }>
              <Title level={ 3 }>{t('command-center.templates.preview-count', { count: preview.count })}</Title>
              <Text>{preview.message}</Text>
              <Text type="secondary">{t('command-center.templates.preview-help')}</Text>
              <ul>{preview.samples?.map((sample, index) => <li key={index}><Text strong>{sample.label}</Text> {sample.before} {sample.after === undefined ? '' : `→ ${sample.after}`}</li>)}</ul>
            </Flex>
          )}
        </Flex>
      </FormKit>
      {output !== '' && <Output text={ output } label={ t('command-center.ui.output') } minHeight={ 120 } maxHeight={ 500 } />}
    </WindowModal>}
  </Flex>
}
