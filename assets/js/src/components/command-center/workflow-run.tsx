import React, { useEffect, useState } from 'react'
import { useTranslation } from '@pimcore/studio-ui-bundle/app'
import { Button } from '@pimcore/studio-ui-bundle/components'
import { commandCenterUrl } from './api'

export interface WorkflowStepResult {
  label: string
  command: string
  status: string
  historyId?: string
  exitCode?: number | null
}
interface WorkflowRun {
  status: string
  workflowLabel?: string
  workflowSteps?: WorkflowStepResult[]
  output: string
  outputTruncated: boolean
  error: string | null
}
export const WorkflowRunView = ({ id, active }: { id: string, active: boolean }): React.JSX.Element => {
  const { t } = useTranslation()
  const [run, setRun] = useState<WorkflowRun>()
  const [step, setStep] = useState<string>()
  const [detail, setDetail] = useState<WorkflowRun>()
  const [error, setError] = useState('')
  useEffect(() => { setRun(undefined); setStep(undefined); setDetail(undefined) }, [id])
  useEffect(() => {
    if (!active) return
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const load = async (): Promise<void> => {
      try {
        const response = await fetch(commandCenterUrl(`history/${id}`), { signal: abort.signal, cache: 'no-store' })
        if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`)
        const data = await response.json() as WorkflowRun
        if (abort.signal.aborted) return
        setRun(data)
        if (step !== undefined) {
          const result = await fetch(commandCenterUrl(`history/${step}`), { signal: abort.signal, cache: 'no-store' })
          if (!result.ok) throw new Error(`${result.status}: ${await result.text()}`)
          const value = await result.json() as WorkflowRun
          if (abort.signal.aborted) return
          setDetail(value)
        }
        setError('')
      } catch (reason) { if (!abort.signal.aborted) setError(String(reason)) }
      finally { if (!abort.signal.aborted) timer = setTimeout(() => { void load() }, 3000) }
    }
    void load()
    return () => { abort.abort(); clearTimeout(timer) }
  }, [id, active, step])
  return <section>
    <h3>{run?.workflowLabel ?? t('command-center.workflows.execution')}</h3>
    <p>{id} · {t(`command-center.history.status.${run?.status ?? 'queued'}`)}</p>
    {run?.status === 'queued' && <p>{t('command-center.workflows.queued-help')}</p>}
    {error !== '' && <p role="alert">{error}</p>}
    {run?.error != null && <p role="alert">{run.error}</p>}
    <ol>{run?.workflowSteps?.map((value, index) => <li key={index} style={{ padding: 8 }}>
      <strong>{value.label}</strong> · <code>{value.command}</code> · {t(`command-center.workflows.step-status.${value.status}`)}
      {value.exitCode != null && ` (${value.exitCode})`}{' '}
      {value.historyId !== undefined && <Button onClick={() => { setDetail(undefined); setStep(value.historyId) }}>{t('command-center.workflows.step-output')}</Button>}
    </li>)}</ol>
    {step !== undefined && <Button onClick={() => { setStep(undefined); setDetail(undefined) }}>{t('command-center.workflows.all-output')}</Button>}
    {(detail ?? run)?.outputTruncated === true && <p>{t('command-center.history.truncated')}</p>}
    <pre aria-label={t('command-center.ui.output')} style={{ background: '#111827', color: '#e5e7eb', padding: 16,
      whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 500, overflow: 'auto', minHeight: 160 }}>{(step === undefined ? run : detail)?.output || t('command-center.ui.no-output')}</pre>
  </section>
}
