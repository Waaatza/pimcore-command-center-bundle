import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from '@pimcore/studio-ui-bundle/app'
import { Alert, Button, Flex, FormKit, Modal, Text } from '@pimcore/studio-ui-bundle/components'
import { actionFetch, type ActionRequest, type ActionResult, type PreparedAction } from './studio-actions-api'
import { InputFields } from './input-fields'
import { Output } from './output'

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
    } catch {
      if (mounted.current) setError(t('command-center.actions.error'))
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

  return <Modal open title={prepared?.label ?? t('command-center.actions.run')} footer={null} onCancel={onClose}>
    <Flex vertical gap={12}>
      {error !== '' && <Alert type="error" message={error} />}
      {prepared !== undefined && !started && <FormKit wrapInPanel={false} formProps={{ disabled: busy }}>
        <InputFields fields={prepared.fields} values={values} onChange={next => { setValues(next); setPreview(undefined) }} />
        {prepared.bound.map((item, index) => <Text key={index}>{item.label}: {item.value}</Text>)}
      </FormKit>}
      {!started && prepared !== undefined && <Flex gap={8}>
        {prepared.previewSupported && <Button disabled={busy} onClick={() => { void showPreview() }}>{t('command-center.templates.preview')}</Button>}
        <Button type="primary" disabled={busy || (prepared.previewSupported && preview?.supported !== true) || prepared.fields.some(field => field.required === true && (values[field.name] ?? field.default ?? '').trim() === '')} onClick={() => { void run() }}>{t('command-center.ui.execute')}</Button>
      </Flex>}
      {preview?.supported === true && <Flex vertical gap={4}>
        <Text>{t('command-center.templates.preview-count', { count: preview.count })}</Text>
        <Text>{preview.message}</Text>
        {preview.samples?.map((item, index) => <Text key={index}>{item.label}: {item.before} → {item.after}</Text>)}
      </Flex>}
      {preview?.supported === false && <Text>{t('command-center.templates.no-preview')}</Text>}
      {result !== undefined && <Flex vertical gap={8}>
        <Text role="status">{t(`command-center.history.status.${result.status}`)}</Text>
        {result.steps.map((step, index) => <Text key={index}>{step.label}: {t(`command-center.workflows.step-status.${step.status}`)}</Text>)}
      </Flex>}
      {output !== '' && <Output text={output} label={t('command-center.ui.output')} maxHeight={320} />}
      <Button onClick={onClose}>{t('command-center.actions.close')}</Button>
    </Flex>
  </Modal>
}
