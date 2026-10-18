import { commandCenterUrl } from './api'
import React, { useEffect, useState } from 'react'
import { Button, Input, Select } from '@pimcore/studio-ui-bundle/components'

export interface CommandDraft {
  command?: string
  tokens: string
  phpCode: string | null
  csrfToken: string
}

interface RunResult {
  status: 'running' | 'success' | 'failed' | 'interrupted'
  startedAt: string
  finishedAt: string | null
  exitCode: number | null
  output?: string
}
interface PlannedCommand {
  id: string
  label: string
  command: string
  tokens?: string[]
  phpCode?: string | null
  repeat: 'once' | 'hourly' | 'daily' | 'weekly'
  timezone: string
  nextRunAt: string | null
  enabled: boolean
  lastRun: RunResult | null
}

const repeatLabels = { once: 'Einmalig', hourly: 'Stündlich', daily: 'Täglich', weekly: 'Wöchentlich' }
const statusLabels = { running: 'Läuft', success: 'Erfolgreich', failed: 'Fehlgeschlagen', interrupted: 'Unterbrochen' }
const formatDate = (value: string | null): string => value === null ? '—' : new Date(value).toLocaleString()

export const ScheduledCommands = ({ draft, active, onEdit }: {
  draft: CommandDraft
  active: boolean
  onEdit: () => void
}): React.JSX.Element => {
  const [items, setItems] = useState<PlannedCommand[]>([])
  const [detail, setDetail] = useState<PlannedCommand>()
  const [selectedId, setSelectedId] = useState<string>()
  const [label, setLabel] = useState('')
  const [runAt, setRunAt] = useState('')
  const [repeat, setRepeat] = useState('once')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [heartbeat, setHeartbeat] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  useEffect(() => {
    if (!active) return
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const load = async (): Promise<void> => {
      try {
        const response = await fetch(commandCenterUrl('schedules'), {
          signal: abort.signal, cache: 'no-store'
        })
        if (!response.ok) throw new Error(`Zeitpläne konnten nicht geladen werden (${response.status}).`)
        const data = await response.json() as { schedules: PlannedCommand[], lastHeartbeat: string | null }
        if (abort.signal.aborted) return
        setItems(data.schedules)
        setHeartbeat(data.lastHeartbeat)
        if (selectedId !== undefined) {
          const result = await fetch(commandCenterUrl(`schedules/${selectedId}`), {
            signal: abort.signal, cache: 'no-store'
          })
          if (result.status === 404) { setSelectedId(undefined); setDetail(undefined) } else {
            if (!result.ok) throw new Error(`Ergebnis konnte nicht geladen werden (${result.status}).`)
            const selected = await result.json() as PlannedCommand
            if (!abort.signal.aborted) setDetail(selected)
          }
        }
      } catch (reason) {
        if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(() => { void load() }, 5000)
      }
    }
    void load()
    return () => { abort.abort(); clearTimeout(timer) }
  }, [active, selectedId, revision])

  const create = async (): Promise<void> => {
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const tokens: unknown = JSON.parse(draft.tokens)
      if (!Array.isArray(tokens) || !tokens.every(value => typeof value === 'string')) {
        throw new Error('Argumente müssen ein JSON-Array aus Strings sein.')
      }
      if (runAt === '' || new Date(runAt).getTime() <= Date.now()) throw new Error('Bitte einen zukünftigen Termin wählen.')
      const response = await fetch(commandCenterUrl('schedules/create'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label, runAt: new Date(runAt).toISOString(), repeat, timezone,
          execution: { ...draft, tokens }
        })
      })
      if (!response.ok) throw new Error(`Zeitplan wurde nicht gespeichert (${response.status}): ${await response.text()}`)
      setNotice('Zeitplan gespeichert.')
      setRevision(value => value + 1)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally { setBusy(false) }
  }

  const action = async (item: PlannedCommand, action: 'enable' | 'disable' | 'delete'): Promise<void> => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(commandCenterUrl('schedules/action'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, action, csrfToken: draft.csrfToken })
      })
      if (!response.ok) throw new Error(`Zeitplan konnte nicht geändert werden (${response.status}): ${await response.text()}`)
      if (action === 'delete' && item.id === selectedId) { setSelectedId(undefined); setDetail(undefined) }
      setRevision(value => value + 1)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally { setBusy(false) }
  }

  return (
    <div style={ { display: 'flex', flexDirection: 'column', gap: 16 } }>
      <p>Ausführungen laufen auch bei geschlossenem Studio. Pro Ausführung gelten maximal fünf Minuten.
        Verpasste Wiederholungen werden zu einer Ausführung zusammengefasst.</p>
      <small>Letztes Worker-Signal: {heartbeat === null ? 'Noch kein Signal empfangen.' : formatDate(heartbeat)}</small>
      <fieldset style={ { display: 'flex', flexDirection: 'column', gap: 12, padding: 16, border: '1px solid #8886' } }>
        <legend>Neuen Zeitplan anlegen</legend>
        <div>Command: <strong>{draft.command ?? 'Noch keiner ausgewählt'}</strong>{draft.phpCode !== null && ' · mit PHP-Code'}
          <Button type="link" onClick={ onEdit }>Command und Parameter bearbeiten</Button>
        </div>
        <small>Verwendet die aktuelle Auswahl aus „Direkt ausführen“. Der gespeicherte Zeitplan behält eine eigene Kopie.</small>
        <label htmlFor="schedule-label">Name</label>
        <Input id="schedule-label" value={ label } maxLength={ 120 } onChange={ event => setLabel(event.target.value) } />
        <label htmlFor="schedule-run-at">Erste Ausführung ({timezone})</label>
        <Input id="schedule-run-at" type="datetime-local" value={ runAt } onChange={ event => setRunAt(event.target.value) } />
        <label htmlFor="schedule-repeat">Wiederholung</label>
        <Select id="schedule-repeat" value={ repeat } style={ { width: '100%', maxWidth: 'none' } }
          options={ Object.entries(repeatLabels).map(([value, label]) => ({ value, label })) }
          onChange={ (value: string) => setRepeat(value) } />
        <div><Button type="primary" disabled={ busy || draft.command === undefined || draft.csrfToken === '' || label.trim() === '' || runAt === '' }
          onClick={ () => { void create() } }>Zeitplan speichern</Button></div>
      </fieldset>
      {error !== '' && <div role="alert">{error}</div>}
      {notice !== '' && <div role="status">{notice}</div>}
      <h3>Gespeicherte Zeitpläne</h3>
      {items.length === 0 && <p>Noch keine geplanten Ausführungen.</p>}
      <div style={ { overflowX: 'auto' } }>
        <table style={ { width: '100%', borderCollapse: 'collapse', textAlign: 'left' } }>
          <thead><tr>
            {['Name / Command', 'Wiederholung', 'Nächste Ausführung', 'Status', 'Letztes Ergebnis', 'Aktionen'].map(text => (
              <th key={ text } style={ { padding: 12 } }>{text}</th>
            ))}
          </tr></thead>
          <tbody>{items.map(item => (
            <tr key={ item.id } style={ { borderTop: '1px solid #8886' } }>
              <td style={ { padding: 12 } }>{item.label}<br /><code>{item.command}</code></td>
              <td style={ { padding: 12 } }>{repeatLabels[item.repeat]}<br /><small>{item.timezone}</small></td>
              <td style={ { padding: 12 } }>{formatDate(item.nextRunAt)}</td>
              <td style={ { padding: 12 } }>{item.lastRun?.status === 'running' ? 'In Ausführung' : item.enabled ? 'Aktiv' : item.nextRunAt === null ? 'Beendet' : 'Deaktiviert'}</td>
              <td style={ { padding: 12 } }>{item.lastRun === null ? 'Noch nicht ausgeführt' :
                `${statusLabels[item.lastRun.status]}${item.lastRun.exitCode !== null ? ` · Exit-Code ${item.lastRun.exitCode}` : ''}`}</td>
              <td style={ { padding: 12 } }>
                <Button disabled={ busy || (!item.enabled && item.nextRunAt === null) }
                  onClick={ () => { void action(item, item.enabled ? 'disable' : 'enable') } }>{item.enabled ? 'Deaktivieren' : 'Aktivieren'}</Button>
                <Button onClick={ () => { setDetail(undefined); setSelectedId(item.id) } }>Details</Button>
                <Button danger disabled={ busy || item.lastRun?.status === 'running' }
                  onClick={ () => { void action(item, 'delete') } }>Löschen</Button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {detail !== undefined && (
        <section>
          <h3>{detail.label}</h3>
          <p>Letzter Start: {formatDate(detail.lastRun?.startedAt ?? null)} · Ende: {formatDate(detail.lastRun?.finishedAt ?? null)}</p>
          <details><summary>Gespeicherte Parameter und PHP-Code</summary>
            <pre style={ { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }>{JSON.stringify(detail.tokens)}{'\n'}{detail.phpCode}</pre>
          </details>
          <pre aria-label="Geplante Command-Ausgabe" style={ {
            background: '#111827', color: '#e5e7eb', padding: 16, overflow: 'auto', maxHeight: 480,
            whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', minHeight: 160
          } }>{detail.lastRun?.output || 'Noch keine Ausgabe.'}</pre>
        </section>
      )}
    </div>
  )
}
