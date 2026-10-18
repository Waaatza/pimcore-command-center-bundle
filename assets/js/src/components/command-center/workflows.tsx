import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from '@pimcore/studio-ui-bundle/app'
import { Alert, Block, Button, Flex, Form, FormKit, Input, Select, Text, TextArea, Title } from '@pimcore/studio-ui-bundle/components'
import { commandCenterUrl } from './api'
import { type CommandDraft } from './scheduled-commands'
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
  const [deleting, setDeleting] = useState(false)
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
    setDeleting(false); setScheduling(false)
    const steps = workflow === undefined
      ? [emptyStep()]
      : workflow.steps.map(step => ({ ...step, tokens: JSON.stringify(step.tokens, null, 2) }))
    stepsRef.current = steps.map(step => ({ ...step }))
    setInitial({ label: workflow?.label ?? '', description: workflow?.description ?? '', steps, fields: workflow?.fields ?? [] })
    setEditor({ id: workflow?.id, revision: workflow?.revision })
    setSession(current => current + 1)
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
  return <Flex vertical gap={ 16 }>
    <Text type="secondary">{t('command-center.workflows.help')}</Text>
    <Flex gap={ 12 }>
      <Flex style={ { flex: 1 } }>
        <Select disabled={busy} style={ { width: '100%', maxWidth: 'none' } } placeholder={t('command-center.workflows.choose')} value={selected}
          options={items.map(value => ({ value: value.id, label: value.label }))} onChange={(id: string) => {
            setSelected(id); setValues({}); setEditor(undefined); setDeleting(false); setScheduling(false); setRunId(undefined); setError('')
          }} />
      </Flex>
      <Button disabled={busy} onClick={() => edit()}>{t('command-center.workflows.new')}</Button>
      {item !== undefined && <Button disabled={busy} onClick={() => edit(item)}>{t('command-center.workflows.edit')}</Button>}
    </Flex>
    {error !== '' && <Alert type="error" message={ error } />}
    {editor !== undefined ? (
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
          <Flex gap={ 12 } wrap>
            <Button disabled={busy || (watchedSteps?.length ?? 0) >= 20 || draft.command === undefined } onClick={ appendDraftStep }>{t('command-center.workflows.from-draft')}</Button>
            <Button type="primary" disabled={busy || watchedLabel.trim() === '' || !stepsReady} onClick={ save }>{t('command-center.workflows.save')}</Button>
            <Button disabled={busy} onClick={() => setEditor(undefined)}>{t('command-center.templates.cancel')}</Button>
          </Flex>
        </Flex>
      </FormKit>
    ) : item !== undefined && (
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
          <Button type="primary" disabled={busy} onClick={() => { void perform(async () => {
            const response = await post('workflows/run', { id: item.id, revision: item.revision, values })
            const run = await response.json() as { id: string }; setRunId(run.id)
          }) }}>{t('command-center.workflows.run')}</Button>
          <Button disabled={busy} onClick={() => { setScheduling(true); setDeleting(false) }}>{t('command-center.workflows.schedule')}</Button>
          <Button disabled={busy} onClick={() => { setDeleting(true); setScheduling(false) }}>{t('command-center.workflows.delete')}</Button>
        </Flex>
        {deleting && (
          <Flex vertical gap={ 8 }>
            <Alert type="warning" message={ t('command-center.workflows.delete-confirm') } />
            <Flex gap={ 12 }>
              <Button danger disabled={busy} onClick={() => { void perform(async () => {
                await post('workflows/delete', { id: item.id, revision: item.revision, values }); setSelected(undefined); setDeleting(false); setRefresh(value => value + 1)
              }) }}>{t('command-center.workflows.delete')}</Button>
              <Button disabled={busy} onClick={() => setDeleting(false)}>{t('command-center.templates.cancel')}</Button>
            </Flex>
          </Flex>
        )}
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
      </Flex>
    )}
    {runId !== undefined && <WorkflowRunView id={runId} active={active} />}
  </Flex>
}
