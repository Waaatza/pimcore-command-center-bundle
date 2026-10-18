import React, { useEffect, useState } from 'react'
import { useTranslation } from '@pimcore/studio-ui-bundle/app'
import { Button, Select } from '@pimcore/studio-ui-bundle/components'
import { commandCenterUrl } from './api'

interface Run {
  id: string
  command: string
  status: string
  source: string
  actorName: string | null
  scheduleLabel: string | null
  templateLabel: string | null
  startedAt: string
  durationMs: number | null
  exitCode: number | null
  tokens?: string[]
  phpCode?: string | null
  output?: string
  outputTruncated?: boolean
  error?: string | null
}

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
        if (selected !== undefined) {
          const result = await fetch(commandCenterUrl(`history/${selected}`), { signal: abort.signal })
          if (!result.ok) throw new Error(`${result.status}: ${await result.text()}`)
          const run = await result.json() as Run
          if (!abort.signal.aborted) setDetail(run)
        }
        setError('')
      } catch (reason) {
        if (!abort.signal.aborted) setError(String(reason))
      }
    }
    void load()
    const interval = window.setInterval(() => { void load() }, 5000)
    return () => { abort.abort(); window.clearInterval(interval) }
  }, [active, page, status, source, search, selected, refresh])
  const date = (value: string): string => new Date(value).toLocaleString(i18n.language)
  return <div style={ { display: 'flex', flexDirection: 'column', gap: 16 } }>
    <p>{t('command-center.history.help')}</p>
    <div style={ { display: 'flex', gap: 12, flexWrap: 'wrap' } }>
      <input aria-label={t('command-center.history.search')} placeholder={t('command-center.history.search')}
        value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} />
      <Select style={{ minWidth: 180 }} value={status} onChange={(value: string) => { setStatus(value); setPage(1) }}
        options={['', 'running', 'success', 'failed', 'timed_out', 'interrupted'].map(value => ({ value, label: t(`command-center.history.status.${value || 'all'}`) }))} />
      <Select style={{ minWidth: 180 }} value={source} onChange={(value: string) => { setSource(value); setPage(1) }}
        options={['', 'manual', 'scheduled', 'template', 'background'].map(value => ({ value, label: t(`command-center.history.source.${value || 'all'}`) }))} />
      <Button onClick={() => setRefresh(value => value + 1)}>{t('command-center.history.refresh')}</Button>
    </div>
    {error !== '' && <div role="alert">{error}</div>}
    <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead><tr>{['started', 'command', 'source', 'status', 'duration', 'exit', 'details'].map(key =>
        <th key={key} style={{ textAlign: 'left', padding: 10 }}>{t(`command-center.history.${key}`)}</th>)}</tr></thead>
      <tbody>{items.map(run => <tr key={run.id}>
        <td style={{ padding: 10 }}>{date(run.startedAt)}</td><td style={{ padding: 10 }}><code>{run.command}</code><br />{run.scheduleLabel ?? run.templateLabel}</td>
        <td style={{ padding: 10 }}>{t(`command-center.history.source.${run.source}`)}<br />{run.actorName}</td>
        <td style={{ padding: 10 }}>{t(`command-center.history.status.${run.status}`)}</td>
        <td style={{ padding: 10 }}>{run.durationMs === null ? '—' : `${(run.durationMs / 1000).toFixed(2)} s`}</td>
        <td style={{ padding: 10 }}>{run.exitCode ?? '—'}</td>
        <td style={{ padding: 10 }}><Button onClick={() => { setDetail(undefined); setSelected(run.id) }}>{t('command-center.history.details')}</Button></td>
      </tr>)}</tbody>
    </table></div>
    {items.length === 0 && <p>{t('command-center.history.empty')}</p>}
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <Button disabled={page <= 1} onClick={() => setPage(value => value - 1)}>{t('command-center.history.previous')}</Button>
      <span>{page} / {Math.max(1, Math.ceil(total / 25))} ({total})</span>
      <Button disabled={page * 25 >= total} onClick={() => setPage(value => value + 1)}>{t('command-center.history.next')}</Button>
    </div>
    {detail !== undefined && <section>
      <h3>{detail.command} · {date(detail.startedAt)}</h3>
      <p>{t(`command-center.history.status.${detail.status}`)} · {detail.id}</p>
      {detail.error != null && <p role="alert">{detail.error}</p>}
      <details><summary>{t('command-center.history.snapshot')}</summary>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(detail.tokens, null, 2)}</pre>
        {detail.phpCode != null && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{detail.phpCode}</pre>}
      </details>
      {detail.outputTruncated === true && <p>{t('command-center.history.truncated')}</p>}
      <pre aria-label={t('command-center.ui.output')} style={{ background: '#111827', color: '#e5e7eb', padding: 16,
        whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', overflow: 'auto', maxHeight: 500, minHeight: 160 }}>{detail.output || t('command-center.ui.no-output')}</pre>
    </section>}
  </div>
}
