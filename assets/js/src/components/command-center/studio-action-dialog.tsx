import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from '@pimcore/studio-ui-bundle/app'
import { Alert, Button, Content, Flex, Form, FormKit, Icon, Tag, Text, WindowModal } from '@pimcore/studio-ui-bundle/components'
import { ActionHttpError, actionFetch, type ActionRequest, type ActionResult, type PreparedAction } from './studio-actions-api'
import { InputFields } from './input-fields'
import { Output } from './output'
import { StepList } from './step-list'
import { statusColor } from './workflow-run'

interface Preview {
  supported: boolean
  count?: number
  message?: string
  samples?: Array<{ label: string, before?: string, after?: string }>
}

export const StudioActionDialog = ({ request, onClose }: {
  request: ActionRequest, onClose: () => void
}): React.JSX.Element => {
  const { t } = useTranslation()
  const [prepared, setPrepared] = useState<PreparedAction>()
  const [values, setValues] = useState<Record<string, string>>({})
  const [previewSnapshot, setPreview] = useState<{ result: Preview, request: string }>()
  const previewKey = JSON.stringify({ ...request, values })
  const currentPreviewKey = useRef(previewKey)
  currentPreviewKey.current = previewKey
  const preview = previewSnapshot?.request === previewKey ? previewSnapshot.result : undefined
  const [result, setResult] = useState<ActionResult>()
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const [started, setStarted] = useState(false)
  const abort = useRef<AbortController>()
  const mounted = useRef(true)

  const run = async (): Promise<void> => {
    if (started) return
    setBusy(true); setStarted(true); setError('')
    const controller = new AbortController()
    abort.current = controller
    try {
      const response = await actionFetch('run', { ...request, values }, controller.signal)
      if ((response.headers.get('Content-Type') ?? '').includes('application/json')) {
        const queued = await response.json() as { id: string }
        setResult({ id: queued.id, status: 'queued', steps: [] })
      } else {
        if (response.body === null) throw new Error()
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let pending = '', runId = ''
        while (true) {
          const { done, value } = await reader.read()
          pending += decoder.decode(value, { stream: !done })
          const lines = pending.split('\n'); pending = lines.pop() ?? ''
          for (const line of lines) {
            if (line === '') continue
            const event = JSON.parse(line) as { type: string, id?: string, code?: number, text?: string }
            if (event.type === 'run') {
              runId = event.id ?? ''
              if (mounted.current) setResult({ id: runId, status: 'running', steps: [] })
            } else if (event.type === 'out' || event.type === 'err') {
              if (mounted.current) setOutput(previous => (previous + (event.text ?? '')).slice(-1000000))
            } else if (event.type === 'error') {
              if (mounted.current) setResult({ id: runId, status: 'failed', steps: [] })
            } else if (event.type === 'exit' && mounted.current) {
              setResult({ id: runId, status: event.code === 0 ? 'success' : 'failed', exitCode: event.code, steps: [] })
            }
          }
          if (done) break
        }
      }
    } catch (error) {
      if (mounted.current) {
        // Nur bestätigte Ablehnungen erlauben einen neuen Start; Netzwerkfehler können einen laufenden Job betreffen.
        if (error instanceof ActionHttpError && [400, 401, 403, 404, 409, 422].includes(error.status)) setStarted(false)
        setError(t('command-center.actions.error'))
      }
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    abort.current = controller
    void actionFetch('prepare', request, controller.signal).then(async response => {
      const value = await response.json() as PreparedAction
      if (!controller.signal.aborted) { setPrepared(value); setBusy(false) }
    }).catch(() => { if (!controller.signal.aborted) { setError(t('command-center.actions.error')); setBusy(false) } })
    return () => { mounted.current = false; abort.current?.abort() }
  }, [])

  useEffect(() => {
    if (prepared?.direct === true && !started) void run()
  }, [prepared])

  useEffect(() => {
    if (result?.status !== 'queued' && !(result?.status === 'running' && prepared?.targetType === 'workflow')) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async (): Promise<void> => {
      try {
        const response = await actionFetch('result', { runId: result.id }, controller.signal)
        const next = await response.json() as ActionResult
        if (!controller.signal.aborted) {
          setResult(next)
          if (next.output !== undefined) setOutput(next.output)
          if (next.status === 'queued' || next.status === 'running') timer = setTimeout(() => { void poll() }, 2000)
        }
      } catch { if (!controller.signal.aborted) setError(t('command-center.actions.error')) }
    }
    void poll()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [result?.id, result?.status, prepared?.targetType])

  const showPreview = async (): Promise<void> => {
    setBusy(true); setError('')
    try {
      const key = previewKey
      const response = await actionFetch('preview', { ...request, values })
      const result = await response.json() as Preview
      if (mounted.current && currentPreviewKey.current === key) setPreview({ result, request: key })
    } catch { setError(t('command-center.actions.error')) } finally { setBusy(false) }
  }

  return <WindowModal open
    size="L"
    limitContentHeight
    title={ <Flex align="center" gap={ 8 }>
      { prepared !== undefined && <Icon value={ prepared.icon } type={ prepared.iconType ?? 'name' } /> }
      <span>{ prepared?.label ?? t('command-center.actions.run') }</span>
    </Flex> }
    onCancel={ onClose }
    footer={ <Flex align="center" justify="space-between">
      <Flex gap={ 8 }>
        { prepared !== undefined && !started && prepared.previewSupported &&
          <Button disabled={ busy } onClick={ () => { void showPreview() } }>{ t('command-center.templates.preview') }</Button> }
      </Flex>
      <Flex gap={ 8 }>
        <Button onClick={ onClose }>{ t('command-center.actions.close') }</Button>
        { prepared !== undefined && !started && <Button type="primary"
          disabled={ busy || (prepared.previewSupported && preview?.supported !== true) || prepared.fields.some(field => field.required === true && (values[field.name] ?? field.default ?? '').trim() === '') }
          onClick={ () => { void run() } }>{ t('command-center.ui.execute') }</Button> }
      </Flex>
    </Flex> }>
    <Flex vertical gap={ 12 }>
      { error !== '' && <Alert type="error" message={ error } /> }
      { prepared === undefined && error === '' && <Content loading /> }
      { started && result === undefined && error === '' && <Content loading /> }
      { prepared !== undefined && !started && <FormKit wrapInPanel={ false } formProps={ { disabled: busy } }>
        <InputFields fields={ prepared.fields } values={ values } onChange={ next => { setValues(next); setPreview(undefined) } } />
        { prepared.bound.map((item, index) => (
          <Form.Item key={ index } label={ item.label }><Text code>{ item.value }</Text></Form.Item>
        )) }
      </FormKit> }
      { preview?.supported === true && <Flex vertical gap={ 4 }>
        <Text strong>{ t('command-center.templates.preview-count', { count: preview.count }) }</Text>
        <Text>{ preview.message }</Text>
        { preview.samples?.map((item, index) => <Text key={ index }>{ item.label }: { item.before } → { item.after }</Text>) }
      </Flex> }
      { preview?.supported === false && <Text type="secondary">{ t('command-center.templates.no-preview') }</Text> }
      { result !== undefined && <Flex vertical gap={ 8 }>
        <Tag role="status" color={ statusColor(result.status) }>{ t(`command-center.history.status.${result.status}`) }</Tag>
        { result.steps.length > 0 && <StepList items={ result.steps.map((step, index) => <React.Fragment key={ index }>
          <Text strong>{ step.label }</Text> · <Tag color={ statusColor(step.status) }>{ t(`command-center.workflows.step-status.${step.status}`) }</Tag>
        </React.Fragment>) } /> }
      </Flex> }
      { output !== '' && <Output text={ output } label={ t('command-center.ui.output') } maxHeight={ 320 } /> }
    </Flex>
  </WindowModal>
}
