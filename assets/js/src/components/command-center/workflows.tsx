import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from '@pimcore/studio-ui-bundle/app'
import { Alert, Block, Button, Flex, Form, FormKit, Grid, Input, Select, Text, TextArea, Title, Tooltip, useAlertModal, WindowModal } from '@pimcore/studio-ui-bundle/components'
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { commandCenterUrl } from './api'
import { type CommandDraft } from './scheduled-commands'
import { tooltipButtonStyle } from './command-templates.styles'
import { padCells } from './grid-cell'
import { NotificationFields, type Recipient } from './notification-fields'
import { WorkflowRunView } from './workflow-run'
import { StepList } from './step-list'
import { InputFields, InputFieldEditor, type InputField } from './input-fields'

interface Step { label: string, command: string, tokens: string[], phpCode: string | null }
interface Workflow { id: string, revision: number, label: string, description: string, steps: Step[], fields?: InputField[] }
interface EditableStep { label: string, command: string, tokens: string, phpCode: string | null }
interface Editor { id?: string, revision?: number }
interface EditorValues { label: string, description: string, steps: EditableStep[], fields: InputField[] }
const emptyStep = (): EditableStep => ({ label: '', command: '', tokens: '[]', phpCode: null })
const normalizeStep = (step: Partial<EditableStep> | undefined): EditableStep => ({
  label: step?.label ?? '', command: step?.command ?? '', tokens: step?.tokens ?? '[]', phpCode: step?.phpCode ?? null
})

const columnHelper = createColumnHelper<Workflow>()

const WorkflowStepRow = ({ step, commands }: { step?: EditableStep, commands: string[] }): React.JSX.Element => {
  const { t } = useTranslation()
  return (
    <>
      <Form.Item label={ t('command-center.templates.label') } name="label" initialValue="">
        <Input maxLength={120} />
      </Form.Item>
      <Form.Item label={ t('command-center.ui.command') } name="command" initialValue="">
        <Select showSearch style={ { width: '100%', maxWidth: 'none' } } options={commands.map(command => ({ value: command, label: command })) } />
      </Form.Item>
      <Form.Item label={ t('command-center.ui.arguments-json') } name="tokens" initialValue="[]">
        <TextArea rows={ 3 } />
      </Form.Item>
      {step?.command === 'pimcore:run-script' && (
        <Form.Item label={ t('command-center.ui.php-code') } name="phpCode" initialValue={ null }>
          <TextArea rows={ 8 } spellCheck={ false } style={ { fontFamily: 'monospace' } } />
        </Form.Item>
      )}
    </>
  )
}

export const Workflows = ({ active, draft, onScheduled }: {
  active: boolean, draft: CommandDraft, onScheduled: () => void
}): React.JSX.Element => {
  const { t } = useTranslation()
  const alertModal = useAlertModal()
  const [editorForm] = Form.useForm<EditorValues>()
  const [items, setItems] = useState<Workflow[]>([])
  const [commands, setCommands] = useState<string[]>([])
  const [csrfToken, setCsrfToken] = useState('')
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [selected, setSelected] = useState<string>()
  const [editor, setEditor] = useState<Editor>()
  const [initial, setInitial] = useState<EditorValues>({ label: '', description: '', steps: [], fields: [] })
  const [session, setSession] = useState(0)
  const [values, setValues] = useState<Record<string, string>>({})
  const watchedFields = Form.useWatch('fields', editorForm) as InputField[] | undefined
  const [runId, setRunId] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [scheduling, setScheduling] = useState(false)
  const [runAt, setRunAt] = useState('')
  const [repeat, setRepeat] = useState('once')
  const [recipientIds, setRecipientIds] = useState<number[]>([])
  const [channels, setChannels] = useState<string[]>([])
  const stepsRef = useRef<EditableStep[]>([])
  const item = items.find(value => value.id === selected)
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const watchedSteps = Form.useWatch('steps', editorForm) as EditableStep[] | undefined
  const watchedLabel = Form.useWatch('label', editorForm) ?? ''
  const stepsReady = watchedSteps !== undefined && watchedSteps.length > 0 &&
    watchedSteps.every(step => (step?.command ?? '') !== '' && (step?.label ?? '').trim() !== '')
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
  const onValuesChange = (changed: Partial<EditorValues>): void => {
    if (!('steps' in changed)) return
    const next = (changed.steps ?? []) as EditableStep[]
    const previous = stepsRef.current
    if (next.length > previous.length) {
      const patched = next.map(normalizeStep)
      stepsRef.current = patched
      editorForm.setFieldValue('steps', patched)
      return
    }
    stepsRef.current = next.map(normalizeStep)
    if (next.length !== previous.length) return
    let changedIndex = -1
    for (let index = 0; index < next.length; index++) {
      if (next[index]?.command !== previous[index]?.command) {
        if (changedIndex !== -1) return
        changedIndex = index
      }
    }
    if (changedIndex === -1) return
    const patched = next.map((step, index) => index === changedIndex ? { ...step, tokens: '[]', phpCode: null } : step)
    stepsRef.current = patched
    editorForm.setFieldValue('steps', patched)
  }
  const edit = (workflow?: Workflow): void => {
    setSelected(undefined)
    setScheduling(false)
    const steps = workflow === undefined
      ? [emptyStep()]
      : workflow.steps.map(step => ({ ...step, tokens: JSON.stringify(step.tokens, null, 2) }))
    stepsRef.current = steps.map(step => ({ ...step }))
    setInitial({ label: workflow?.label ?? '', description: workflow?.description ?? '', steps, fields: workflow?.fields ?? [] })
    setEditor({ id: workflow?.id, revision: workflow?.revision })
    setSession(current => current + 1)
  }
  const open = (workflow: Workflow): void => {
    setSelected(workflow.id); setValues({}); setEditor(undefined); setScheduling(false); setRunId(undefined); setError('')
  }
  const run = (workflow: Workflow, runValues: Record<string, string>): void => {
    void perform(async () => {
      const response = await post('workflows/run', { id: workflow.id, revision: workflow.revision, values: runValues })
      const queued = await response.json() as { id: string }
      setRunId(queued.id)
    })
  }
  const runFromRow = (workflow: Workflow): void => {
    open(workflow)
    run(workflow, {})
  }
  const confirmDelete = (workflow: Workflow): void => {
    alertModal.warn({
      title: t('command-center.workflows.delete'),
      content: t('command-center.workflows.delete-confirm'),
      okButtonProps: { danger: true },
      onOk: () => { void perform(async () => {
        await post('workflows/delete', { id: workflow.id, revision: workflow.revision, values: {} })
        if (selected === workflow.id) setSelected(undefined)
        setRefresh(value => value + 1)
      }) }
    })
  }
  const currentSteps = (): EditableStep[] => (editorForm.getFieldsValue(true).steps ?? []).map(normalizeStep)
  const appendDraftStep = (): void => {
    void (async () => {
      await new Promise(resolve => { window.setTimeout(resolve, 20) })
      const steps = currentSteps()
      const step: EditableStep = { label: draft.command ?? '', command: draft.command ?? '', tokens: draft.tokens, phpCode: draft.phpCode }
      const next = steps.length === 1 && steps[0].command === '' ? [step] : [...steps, step]
      stepsRef.current = next.map(value => ({ ...value }))
      editorForm.setFieldValue('steps', next)
    })()
  }
  const save = (): void => {
    void perform(async () => {
      await new Promise(resolve => { window.setTimeout(resolve, 30) })
      const values = editorForm.getFieldsValue(true) as EditorValues
      const steps = (values.steps ?? []).map(raw => {
        const step = normalizeStep(raw)
        const tokens: unknown = JSON.parse(step.tokens)
        if (!Array.isArray(tokens) || !tokens.every(value => typeof value === 'string')) throw new Error(t('command-center.error.arguments'))
        return { label: step.label, command: step.command, tokens, phpCode: step.command === 'pimcore:run-script' ? step.phpCode : null }
      })
      const response = await post('workflows/save', { label: values.label, description: values.description, id: editor?.id ?? null, revision: editor?.revision ?? null, steps, fields: values.fields ?? [] })
      const saved = await response.json() as Workflow
      setSelected(saved.id); setEditor(undefined); setRefresh(value => value + 1)
    })
  }
  const columns: ColumnDef<any, any>[] = [
    columnHelper.accessor('label', {
      header: t('command-center.templates.label'), size: 240, meta: { autoWidth: true },
      cell: info => <Flex vertical gap={ 0 }>
        <Text>{ info.getValue() }</Text>
        {info.row.original.description !== '' && <Text type="secondary">{ info.row.original.description }</Text>}
      </Flex>
    }),
    columnHelper.display({
      id: 'steps', header: t('command-center.workflows.steps'), size: 110,
      cell: info => <Text>{ info.row.original.steps.length }</Text>
    }),
    columnHelper.display({
      id: 'fields', header: t('command-center.templates.fields'), size: 120,
      cell: info => {
        const count = (info.row.original.fields ?? []).length
        return <Text type={ count === 0 ? 'secondary' : undefined }>{ count }</Text>
      }
    }),
    columnHelper.display({
      id: 'actions', header: t('command-center.ui.actions'), size: 420,
      cell: info => {
        const value = info.row.original
        const runHint = (value.fields ?? []).length > 0 ? t('command-center.workflows.run-fields-hint') : undefined
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
    <Text type="secondary">{t('command-center.workflows.help')}</Text>
    <Flex gap={ 12 } justify="flex-end">
      <Button disabled={busy} onClick={() => edit()}>{t('command-center.workflows.new')}</Button>
    </Flex>
    {error !== '' && editor === undefined && item === undefined && <Alert type="error" message={ error } />}
    {items.length === 0 && <Text type="secondary">{t('command-center.workflows.empty')}</Text>}
    <Grid autoWidth columns={ padCells(columns) } data={ items } size="small" />
    {busy && <Text role="status">{t('command-center.status.running-progress')}</Text>}
    {editor !== undefined && <WindowModal open={ active } size="L" limitContentHeight
      title={ editor.id === undefined ? t('command-center.workflows.new') : t('command-center.workflows.edit') }
      onCancel={ () => { if (!busy) setEditor(undefined) } }
      footer={ <Flex align="center" justify="space-between">
        <Button disabled={busy || (watchedSteps?.length ?? 0) >= 20 || draft.command === undefined} onClick={ appendDraftStep }>{t('command-center.workflows.from-draft')}</Button>
        <Flex gap={ 12 }>
          <Button disabled={busy} onClick={() => setEditor(undefined)}>{t('command-center.templates.cancel')}</Button>
          <Button type="primary" disabled={busy || watchedLabel.trim() === '' || !stepsReady} onClick={ save }>{t('command-center.workflows.save')}</Button>
        </Flex>
      </Flex> }>
      {error !== '' && <Alert type="error" message={ error } />}
      <FormKit key={ session } wrapInPanel={ false } formProps={ { form: editorForm, disabled: busy, initialValues: initial, onValuesChange } }>
        <Flex vertical gap={ 12 }>
          <Form.Item label={ t('command-center.templates.label') } name="label">
            <Input maxLength={ 120 } />
          </Form.Item>
          <Form.Item label={ t('command-center.templates.description') } name="description">
            <TextArea />
          </Form.Item>
          <Form.Item label={t('command-center.actions.fields')} name="fields">
            <Block border maxItems={30} noteditable={busy}
              getItemTitle={(value: InputField | undefined) => value?.label || t('command-center.actions.field')}>
              {({ blockIndex }) => <InputFieldEditor field={watchedFields?.[blockIndex]} />}
            </Block>
          </Form.Item>
          <Form.Item label={ t('command-center.workflows.steps') } name="steps">
            <Block border maxItems={ 20 } noteditable={ busy }
              getItemTitle={ (itemValue: EditableStep | undefined, index) => itemValue?.label || itemValue?.command || t('command-center.workflows.step', { number: index + 1 }) }>
              { ({ blockIndex }) => <WorkflowStepRow step={ watchedSteps?.[blockIndex] } commands={ commands } /> }
            </Block>
          </Form.Item>
        </Flex>
      </FormKit>
    </WindowModal>}
    {item !== undefined && <WindowModal open={ active } size="L" limitContentHeight title={ t('command-center.ui.details') }
      onCancel={ () => { if (!busy) closeDetails() } }
      footer={ <Button disabled={ busy } onClick={ closeDetails }>{t('command-center.actions.close')}</Button> }>
      {error !== '' && <Alert type="error" message={ error } />}
      <Flex vertical gap={ 12 }>
        <Title level={ 3 }>{item.label}</Title>
        <Text>{item.description}</Text>
        <FormKit wrapInPanel={false} formProps={{ disabled: busy }}>
          <InputFields fields={item.fields ?? []} values={values} onChange={setValues} />
        </FormKit>
        <StepList items={ item.steps.map((step, index) => (
          <React.Fragment key={ index }><Text strong>{step.label}</Text> · <Text code>{step.command}</Text></React.Fragment>
        )) } />
        <Flex gap={ 12 }>
          <Button type="primary" disabled={busy} onClick={() => run(item, values)}>{t('command-center.workflows.run')}</Button>
          <Button disabled={busy} onClick={() => setScheduling(true)}>{t('command-center.workflows.schedule')}</Button>
        </Flex>
        {scheduling && (
          <FormKit wrapInPanel={ false } formProps={ { disabled: busy } }>
            <FormKit.Panel theme="fieldset" title={ t('command-center.workflows.schedule') }>
              <Flex vertical gap={ 12 }>
                <Text type="secondary">{t('command-center.workflows.snapshot-help')}</Text>
                <Form.Item label={ t('command-center.ui.first-at', { timezone, interpolation: { escapeValue: false } }) }>
                  <Input type="datetime-local" value={ runAt } onChange={ event => setRunAt(event.target.value) } />
                </Form.Item>
                <Form.Item label={ t('command-center.ui.repeat') }>
                  <Select style={ { width: '100%', maxWidth: 'none' } } value={ repeat } options={ ['once', 'hourly', 'daily', 'weekly'].map(value => ({ value, label: t(`command-center.repeat.${value}`) })) } onChange={(value: string) => setRepeat(value)} />
                </Form.Item>
                <NotificationFields recipients={ recipients } ids={ recipientIds } channels={ channels } onIds={ setRecipientIds } onChannels={ setChannels } />
                <Flex gap={ 12 }>
                  <Button type="primary" disabled={busy || runAt === ''} onClick={() => { void perform(async () => {
                    if (new Date(runAt).getTime() <= Date.now()) throw new Error(t('command-center.error.future-date'))
                    await post('schedules/create', { label: item.label, runAt: new Date(runAt).toISOString(), repeat, timezone,
                      notificationRecipientIds: recipientIds, notificationChannels: channels,
                      execution: { command: item.steps[0].command, tokens: item.steps[0].tokens, phpCode: item.steps[0].phpCode, csrfToken }, workflow: { id: item.id, revision: item.revision, values } })
                    setScheduling(false); onScheduled()
                  }) }}>{t('command-center.ui.save-schedule')}</Button>
                  <Button disabled={busy} onClick={() => setScheduling(false)}>{t('command-center.templates.cancel')}</Button>
                </Flex>
              </Flex>
            </FormKit.Panel>
          </FormKit>
        )}
        {runId !== undefined && <WorkflowRunView id={runId} active={active} />}
      </Flex>
    </WindowModal>}
  </Flex>
}
