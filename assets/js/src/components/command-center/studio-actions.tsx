import React, { useEffect, useState } from 'react'
import { useTranslation } from '@pimcore/studio-ui-bundle/app'
import { Alert, Button, Flex, Form, FormKit, Input, Modal, Select, Switch, Text } from '@pimcore/studio-ui-bundle/components'
import { actionFetch, actionsChanged, type ActionPlacement } from './studio-actions-api'
import type { InputField } from './input-fields'

interface Binding { source: 'input' | 'fixed' | 'id' | 'path' | 'type', value?: string }
interface ActionDefinition {
  id?: string
  revision?: number
  label: string
  icon: string
  position: number
  enabled: boolean
  targetType: 'template' | 'workflow'
  targetId: string
  placements: ActionPlacement[]
  userIds: number[]
  roleIds: number[]
  objectClasses: string[]
  elementPermission: 'read' | 'write'
  direct: boolean
  showOutput: boolean
  bindings: Record<string, Binding>
}
interface Target { id: string, label: string, fields?: InputField[] }
interface Catalog {
  items: ActionDefinition[]
  templates: Target[]
  workflows: Target[]
  users: Array<{ value: number, label: string }>
  roles: Array<{ value: number, label: string }>
  classes: Array<{ value: string, label: string }>
  csrfToken: string
}
const blank = (): ActionDefinition => ({
  label: '', icon: 'play', position: 0, enabled: false, targetType: 'template', targetId: '',
  placements: [], userIds: [], roleIds: [], objectClasses: [], elementPermission: 'write',
  direct: false, showOutput: false, bindings: {}
})

export const StudioActions = ({ active }: { active: boolean }): React.JSX.Element => {
  const { t } = useTranslation()
  const [catalog, setCatalog] = useState<Catalog>()
  const [editor, setEditor] = useState<ActionDefinition>()
  const [selected, setSelected] = useState<string>()
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!active) return
    const abort = new AbortController()
    void actionFetch('admin', undefined, abort.signal).then(async response => {
      const data = await response.json() as Catalog
      if (!abort.signal.aborted) setCatalog(data)
    }).catch(() => { if (!abort.signal.aborted) setError(t('command-center.actions.error')) })
    return () => { abort.abort() }
  }, [active, refresh])
  const patch = (value: Partial<ActionDefinition>): void => setEditor(current => current === undefined ? current : { ...current, ...value })
  const target = editor === undefined ? undefined : (editor.targetType === 'template' ? catalog?.templates : catalog?.workflows)?.find(item => item.id === editor.targetId)
  const saved = async (remove: boolean): Promise<void> => {
    if (catalog === undefined || editor === undefined) return
    setBusy(true); setError('')
    try {
      const response = await actionFetch(remove ? 'delete' : 'save', { ...editor, csrfToken: catalog.csrfToken })
      if (!remove) {
        const value = await response.json() as ActionDefinition
        setEditor(value); setSelected(value.id)
      } else { setEditor(undefined); setSelected(undefined) }
      setDeleting(false); setRefresh(value => value + 1)
      window.dispatchEvent(new Event(actionsChanged))
    } catch { setError(t('command-center.actions.error')) } finally { setBusy(false) }
  }
  return <Flex vertical gap={16}>
    <Text>{t('command-center.actions.help')}</Text>
    <Flex gap={8}>
      <Select value={selected} placeholder={t('command-center.actions.choose')} disabled={busy}
        options={(catalog?.items ?? []).map(item => ({ value: item.id, label: item.label }))}
        onChange={(id: string) => { setSelected(id); setEditor(catalog?.items.find(item => item.id === id)); setError('') }} />
      <Button disabled={busy || catalog === undefined} onClick={() => { setEditor(blank()); setSelected(undefined); setError('') }}>{t('command-center.actions.new')}</Button>
    </Flex>
    {error !== '' && <Alert type="error" message={error} />}
    {editor !== undefined && <FormKit wrapInPanel={false} formProps={{ disabled: busy }}>
      <Form.Item label={t('command-center.templates.label')}>
        <Input value={editor.label} maxLength={120} onChange={event => patch({ label: event.target.value })} />
      </Form.Item>
      <Form.Item label={t('command-center.actions.target')}>
        <Select value={editor.targetId === '' ? undefined : `${editor.targetType}:${editor.targetId}`}
          options={[
            ...(catalog?.templates ?? []).map(item => ({ value: `template:${item.id}`, label: `${t('command-center.tabs.templates')}: ${item.label}` })),
            ...(catalog?.workflows ?? []).map(item => ({ value: `workflow:${item.id}`, label: `${t('command-center.tabs.workflows')}: ${item.label}` }))
          ]}
          onChange={(value: string) => {
            const [type, id] = value.split(':')
            patch({ targetType: type as 'template' | 'workflow', targetId: id, bindings: {} })
          }} />
      </Form.Item>
      <Form.Item label={t('command-center.actions.icon')}>
        <Input value={editor.icon} maxLength={80} onChange={event => patch({ icon: event.target.value })} />
      </Form.Item>
      <Form.Item label={t('command-center.actions.position')}>
        <Input type="number" value={editor.position} onChange={event => patch({ position: Number(event.target.value) })} />
      </Form.Item>
      <Form.Item label={t('command-center.actions.placements')}>
        <Select mode="multiple" value={editor.placements}
          options={(['global', 'object', 'asset', 'document'] as const).map(value => ({ value, label: t(`command-center.actions.placement.${value}`) }))}
          onChange={(placements: ActionPlacement[]) => patch({ placements })} />
      </Form.Item>
      <Form.Item label={t('command-center.actions.users')}>
        <Select mode="multiple" showSearch optionFilterProp="label" value={editor.userIds} options={catalog?.users}
          onChange={(userIds: number[]) => patch({ userIds })} />
      </Form.Item>
      <Form.Item label={t('command-center.actions.roles')}>
        <Select mode="multiple" showSearch optionFilterProp="label" value={editor.roleIds} options={catalog?.roles}
          onChange={(roleIds: number[]) => patch({ roleIds })} />
      </Form.Item>
      {editor.placements.includes('object') && <Form.Item label={t('command-center.actions.classes')}>
        <Select mode="multiple" value={editor.objectClasses} options={catalog?.classes}
          onChange={(objectClasses: string[]) => patch({ objectClasses })} />
      </Form.Item>}
      {editor.placements.some(place => place !== 'global') && <Form.Item label={t('command-center.actions.element-permission')}>
        <Select value={editor.elementPermission} options={['read', 'write'].map(value => ({ value, label: t(`command-center.actions.permission.${value}`) }))}
          onChange={(elementPermission: 'read' | 'write') => patch({ elementPermission })} />
      </Form.Item>}
      {(target?.fields ?? []).map(field => {
        const binding = editor.bindings[field.name] ?? { source: 'input' }
        return <Form.Item key={field.name} label={field.label}>
          <Flex gap={8}>
            <Select value={binding.source} options={['input', 'fixed', 'id', 'path', 'type'].map(value => ({ value, label: t(`command-center.actions.binding.${value}`) }))}
              onChange={(source: Binding['source']) => patch({ bindings: { ...editor.bindings, [field.name]: { source } } })} />
            {binding.source === 'fixed' && <Input value={binding.value ?? ''} onChange={event => patch({
              bindings: { ...editor.bindings, [field.name]: { source: 'fixed', value: event.target.value } }
            })} />}
          </Flex>
        </Form.Item>
      })}
      <Form.Item label={t('command-center.actions.enabled')}><Switch checked={editor.enabled} onChange={enabled => patch({ enabled })} /></Form.Item>
      <Form.Item label={t('command-center.actions.direct')}><Switch checked={editor.direct} onChange={direct => patch({ direct })} /></Form.Item>
      <Form.Item label={t('command-center.actions.show-output')}><Switch checked={editor.showOutput} onChange={showOutput => patch({ showOutput })} /></Form.Item>
      <Flex gap={8}>
        <Button type="primary" disabled={busy || editor.label.trim() === '' || editor.targetId === '' || editor.placements.length === 0}
          onClick={() => { void saved(false) }}>{t('command-center.actions.save')}</Button>
        {editor.id !== undefined && <Button danger disabled={busy} onClick={() => setDeleting(true)}>{t('command-center.actions.delete')}</Button>}
        <Button disabled={busy} onClick={() => { setEditor(undefined); setSelected(undefined) }}>{t('command-center.templates.cancel')}</Button>
      </Flex>
    </FormKit>}
    {deleting && <Modal open title={t('command-center.actions.delete')} onCancel={() => setDeleting(false)}
      confirmLoading={busy} onOk={() => { void saved(true) }}>
      <Text>{t('command-center.actions.delete-confirm')}</Text>
    </Modal>}
  </Flex>
}
