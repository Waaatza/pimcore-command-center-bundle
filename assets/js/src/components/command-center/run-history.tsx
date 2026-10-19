import React, { useEffect, useState } from 'react'
import { useTranslation } from '@pimcore/studio-ui-bundle/app'
import { Alert, Button, Collapse, Content, Flex, Grid, SearchInput, Select, Tag, Text, Title, WindowModal } from '@pimcore/studio-ui-bundle/components'
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { WorkflowRunView, statusColor } from './workflow-run'
import { Output } from './output'
import { commandCenterUrl } from './api'

interface Run {
  id: string
  command: string
  status: string
  source: string
  actorName: string | null
  scheduleLabel: string | null
  templateLabel: string | null
  workflowLabel?: string
  parentRunId?: string
  workflowSteps?: unknown[]
  createdAt?: string
  startedAt: string | null
  durationMs: number | null
  exitCode: number | null
  tokens?: string[]
  phpCode?: string | null
  output?: string
  outputTruncated?: boolean
  error?: string | null
}

const columnHelper = createColumnHelper<Run>()

export const RunHistory = ({ active }: { active: boolean }): React.JSX.Element => {
  const { t, i18n } = useTranslation()
  const [items, setItems] = useState<Run[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [source, setSource] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string>()
  const [detail, setDetail] = useState<Run>()
  const [error, setError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    if (!active) return
    const abort = new AbortController()
    const load = async (): Promise<void> => {
      try {
        const params = new URLSearchParams({ page: String(page), status, source, search })
        const response = await fetch(commandCenterUrl(`history?${params.toString()}`), { signal: abort.signal })
        if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`)
        const data = await response.json() as { items: Run[], total: number }
        if (abort.signal.aborted) return
        setItems(data.items); setTotal(data.total)
        setError('')
      } catch (reason) {
        if (!abort.signal.aborted) setError(String(reason))
      }
    }
    void load()
    const interval = window.setInterval(() => { void load() }, 5000)
    return () => { abort.abort(); window.clearInterval(interval) }
  }, [active, page, status, source, search, refresh])
  useEffect(() => {
    if (!active || selected === undefined) return
    const abort = new AbortController()
    setDetail(undefined); setDetailError('')
    const load = async (): Promise<void> => {
      try {
        const response = await fetch(commandCenterUrl(`history/${selected}`), { signal: abort.signal })
        if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`)
        const run = await response.json() as Run
        if (!abort.signal.aborted) { setDetail(run); setDetailError('') }
      } catch (reason) {
        if (!abort.signal.aborted) setDetailError(String(reason))
      }
    }
    void load()
    const interval = window.setInterval(() => { void load() }, 5000)
    return () => { abort.abort(); window.clearInterval(interval) }
  }, [active, selected, refresh])
  const closeDetail = (): void => { setSelected(undefined); setDetail(undefined) }
  const date = (value: string | null): string => value === null ? '—' : new Date(value).toLocaleString(i18n.language)
  const columns: ColumnDef<any, any>[] = [
    columnHelper.accessor(row => date(row.startedAt ?? row.createdAt ?? null), {
      id: 'started', header: t('command-center.history.started'), size: 180
    }),
    columnHelper.accessor('command', {
      header: t('command-center.history.command'), size: 240, meta: { autoWidth: true },
      cell: info => <Flex vertical gap={ 0 }>
        <Text code>{info.getValue()}</Text>
        <Text type="secondary">{info.row.original.workflowLabel ?? info.row.original.scheduleLabel ?? info.row.original.templateLabel}</Text>
      </Flex>
    }),
    columnHelper.accessor('source', {
      header: t('command-center.history.source'), size: 150,
      cell: info => <Flex vertical gap={ 0 }>
        <Text>{t(`command-center.history.source.${info.getValue()}`)}</Text>
        <Text type="secondary">{info.row.original.actorName}</Text>
      </Flex>
    }),
    columnHelper.accessor('status', {
      header: t('command-center.history.status'), size: 130,
      cell: info => <Tag color={ statusColor(info.getValue()) }>{t(`command-center.history.status.${info.getValue()}`)}</Tag>
    }),
    columnHelper.accessor(row => row.durationMs === null ? '—' : `${(row.durationMs / 1000).toFixed(2)} s`, {
      id: 'duration', header: t('command-center.history.duration'), size: 110
    }),
    columnHelper.accessor('exitCode', {
      header: t('command-center.history.exit'), size: 100,
      cell: info => info.getValue() ?? '—'
    }),
    columnHelper.display({
      id: 'details', header: t('command-center.history.details'), size: 110,
      cell: info => <Button onClick={ () => { setDetail(undefined); setSelected(info.row.original.id) } }>{t('command-center.history.details')}</Button>
    })
  ]
  return <Flex vertical gap={ 16 }>
    <Text type="secondary">{t('command-center.history.help')}</Text>
    <Flex gap={ 12 } wrap>
      <SearchInput aria-label={ t('command-center.history.search') } placeholder={ t('command-center.history.search') }
        value={ search } maxWidth={ 320 } onChange={ event => { setSearch(event.target.value); setPage(1) } } />
      <Select style={{ minWidth: 180 }} value={status} onChange={(value: string) => { setStatus(value); setPage(1) }}
        options={['', 'queued', 'running', 'success', 'failed', 'timed_out', 'interrupted'].map(value => ({ value, label: t(`command-center.history.status.${value || 'all'}`) }))} />
      <Select style={{ minWidth: 180 }} value={source} onChange={(value: string) => { setSource(value); setPage(1) }}
        options={['', 'manual', 'scheduled', 'template', 'workflow', 'background'].map(value => ({ value, label: t(`command-center.history.source.${value || 'all'}`) }))} />
      <Button onClick={() => setRefresh(value => value + 1)}>{t('command-center.history.refresh')}</Button>
    </Flex>
    {error !== '' && <Alert type="error" message={ error } />}
    <Grid autoWidth columns={ columns } data={ items } size="small" />
    {items.length === 0 && <Text type="secondary">{t('command-center.history.empty')}</Text>}
    <Flex gap={ 12 } align="center">
      <Button disabled={page <= 1} onClick={() => setPage(value => value - 1)}>{t('command-center.history.previous')}</Button>
      <Text>{page} / {Math.max(1, Math.ceil(total / 25))} ({total})</Text>
      <Button disabled={page * 25 >= total} onClick={() => setPage(value => value + 1)}>{t('command-center.history.next')}</Button>
    </Flex>
    {selected !== undefined && <WindowModal open={active} size="L" limitContentHeight title={t('command-center.history.details')}
      onCancel={closeDetail} footer={<Button onClick={closeDetail}>{t('command-center.actions.close')}</Button>}>
      {detailError !== '' && <Alert type="error" message={detailError} />}
      {detail === undefined && detailError === '' && <Content loading />}
      {detail !== undefined && <Flex vertical gap={ 8 }>
        {detail.parentRunId !== undefined && <Button onClick={() => { setDetail(undefined); setSelected(detail.parentRunId) }}>{t('command-center.workflows.parent')}</Button>}
        {detail.workflowSteps !== undefined && <WorkflowRunView id={detail.id} active={active} />}
        <Title level={ 3 }>{detail.command} · {date(detail.startedAt)}</Title>
        <Flex align="center" gap={ 8 }>
          <Tag color={ statusColor(detail.status) }>{t(`command-center.history.status.${detail.status}`)}</Tag>
          <Text type="secondary">{detail.id}</Text>
        </Flex>
        {detail.error != null && <Alert type="error" message={ detail.error } />}
        <Collapse items={ [{ key: 'snapshot', label: t('command-center.history.snapshot'), children: (
          <Flex vertical gap={ 8 }>
            <Output text={ JSON.stringify(detail.tokens, null, 2) } label={ t('command-center.history.snapshot') } />
            {detail.phpCode != null && <Output text={ detail.phpCode } label={ t('command-center.ui.php-code') } />}
          </Flex>
        ) }] } />
        {detail.outputTruncated === true && <Text type="secondary">{t('command-center.history.truncated')}</Text>}
        <Output text={ detail.output } minHeight={ 160 } maxHeight={ 500 } />
      </Flex>}
    </WindowModal>}
  </Flex>
}
