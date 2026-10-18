import React, { useEffect, useState } from 'react'
import { useTranslation } from '@pimcore/studio-ui-bundle/app'
import { Alert, Button, Flex, Tag, Text, Title } from '@pimcore/studio-ui-bundle/components'
import { commandCenterUrl } from './api'
import { Output } from './output'
import { StepList } from './step-list'

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

export const statusColor = (status: string): string => {
  switch (status) {
    case 'success':
      return 'success'
    case 'running':
    case 'queued':
      return 'processing'
    case 'failed':
    case 'timed_out':
      return 'error'
    case 'interrupted':
      return 'warning'
    default:
      return 'default'
  }
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
    <Flex vertical gap={ 8 }>
      <Title level={ 3 }>{run?.workflowLabel ?? t('command-center.workflows.execution')}</Title>
      <Flex align="center" gap={ 8 }>
        <Text type="secondary">{id}</Text>
        <Tag color={ statusColor(run?.status ?? 'queued') }>{t(`command-center.history.status.${run?.status ?? 'queued'}`)}</Tag>
      </Flex>
      {run?.status === 'queued' && <Text type="secondary" role="status">{t('command-center.workflows.queued-help')}</Text>}
      {error !== '' && <Alert type="error" message={ error } />}
      {run?.error != null && <Alert type="error" message={ run.error } />}
      <StepList items={ (run?.workflowSteps ?? []).map((value, index) => <React.Fragment key={ index }>
        <Text strong>{value.label}</Text> · <Text code>{value.command}</Text> ·{' '}
        <Tag color={ statusColor(value.status) }>{t(`command-center.workflows.step-status.${value.status}`)}</Tag>
        {value.exitCode != null && ` (${value.exitCode})`}{' '}
        {value.historyId !== undefined && <Button onClick={ () => { setDetail(undefined); setStep(value.historyId) } }>{t('command-center.workflows.step-output')}</Button>}
      </React.Fragment>) } />
      {step !== undefined && <Button onClick={ () => { setStep(undefined); setDetail(undefined) } }>{t('command-center.workflows.all-output')}</Button>}
      {(detail ?? run)?.outputTruncated === true && <Text type="secondary">{t('command-center.history.truncated')}</Text>}
      <Output text={ (step === undefined ? run : detail)?.output } minHeight={ 160 } maxHeight={ 500 } />
    </Flex>
  </section>
}
