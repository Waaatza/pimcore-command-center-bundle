import React, { useEffect, useState } from 'react'
import { useTranslation } from '@pimcore/studio-ui-bundle/app'
import { Alert, Box, Button, Content, Flex, Form, FormKit, Grid, Icon, IconSelector, Input, Select, Switch, Tag, Text, useAlertModal } from '@pimcore/studio-ui-bundle/components'
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { actionFetch, actionsChanged, type ActionPlacement } from './studio-actions-api'
import type { InputField } from './input-fields'

interface Binding { source: 'input' | 'fixed' | 'id' | 'path' | 'type', value?: string }
interface ActionDefinition {
  id?: string
  revision?: number
  label: string
  icon: string
  iconType?: 'name' | 'path'
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

const columnHelper = createColumnHelper<ActionDefinition>()

export const StudioActions = ({ active }: { active: boolean }): React.JSX.Element => {
  const { t } = useTranslation()
  const alertModal = useAlertModal()
  const [catalog, setCatalog] = useState<Catalog>()
  const [editor, setEditor] = useState<ActionDefinition>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refresh, setRefresh] = useState(0)
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
  const submit = async (item: ActionDefinition, remove: boolean): Promise<void> => {
    if (catalog === undefined) return
    setBusy(true); setError('')
    try {
      await actionFetch(remove ? 'delete' : 'save', { ...item, csrfToken: catalog.csrfToken })
      setNotice(t('command-center.actions.saved'))
      setEditor(undefined)
      setRefresh(value => value + 1)
      window.dispatchEvent(new Event(actionsChanged))
    } catch { setError(t('command-center.actions.error')) } finally { setBusy(false) }
  }
  const confirmDelete = (item: ActionDefinition): void => {
    alertModal.warn({
      title: t('command-center.actions.delete'),
      content: t('command-center.actions.delete-confirm'),
      okButtonProps: { danger: true },
      onOk: () => { void submit(item, true) }
    })
  }
  const columns: ColumnDef<any, any>[] = [
    columnHelper.display({
      id: 'label', header: t('command-center.templates.label'), size: 180,
      cell: info => <Flex align="center" gap={ 8 }>
        <Icon value={ info.row.original.icon } type={ info.row.original.iconType ?? 'name' } />
        <Text>{ info.row.original.label }</Text>
      </Flex>
    }),
    columnHelper.display({
      id: 'target', header: t('command-center.actions.target'), size: 160,
      cell: info => {
        const item = info.row.original
        const found = (item.targetType === 'template' ? catalog?.templates : catalog?.workflows)?.find(value => value.id === item.targetId)
        return <Text>{ found?.label ?? '—' }</Text>
      }
    }),
    columnHelper.display({
      id: 'placements', header: t('command-center.actions.placements'), size: 150,
      cell: info => <Flex gap={ 4 } wrap>
        { info.row.original.placements.map(place => <Tag key={ place }>{ t(`command-center.actions.placement.${ place }`) }</Tag>) }
      </Flex>
    }),
    columnHelper.display({
      id: 'grants', header: t('command-center.actions.section.grants'), size: 150, meta: { autoWidth: true },
      cell: info => {
        const item = info.row.original
        if (item.userIds.length === 0 && item.roleIds.length === 0) {
          return <Text type="secondary">{ t('command-center.actions.grants-admins') }</Text>
        }
        const names = [
          ...(catalog?.users ?? []).filter(user => item.userIds.includes(user.value)).map(user => user.label),
          ...(catalog?.roles ?? []).filter(role => item.roleIds.includes(role.value)).map(role => role.label)
        ]
        return <Text>{ names.join(', ') }</Text>
      }
    }),
    columnHelper.display({
      id: 'status', header: t('command-center.ui.status'), size: 100,
      cell: info => <Tag color={ info.row.original.enabled ? 'success' : 'default' }>
        { info.row.original.enabled ? t('command-center.status.active') : t('command-center.status.disabled') }
      </Tag>
    }),
    columnHelper.accessor('position', { header: t('command-center.actions.position'), size: 70 }),
    columnHelper.display({
      id: 'actions', header: t('command-center.ui.actions'), size: 210,
      cell: info => <Flex gap={ 8 }>
        <Button disabled={ busy }
          onClick={ () => { setEditor({ ...info.row.original }); setError(''); setNotice('') } }>{ t('command-center.ui.edit') }</Button>
        <Button danger disabled={ busy } onClick={ () => confirmDelete(info.row.original) }>{ t('command-center.ui.delete') }</Button>
      </Flex>
    })
  ]
  return <Flex vertical gap={ 16 }>
    <Text type="secondary">{ t('command-center.actions.help') }</Text>
    <Flex justify="flex-end">
      <Button disabled={ busy || catalog === undefined }
        onClick={ () => { setEditor(blank()); setError(''); setNotice('') } }>{ t('command-center.actions.new') }</Button>
    </Flex>
    {error !== '' && <Alert type="error" message={ error } />}
    {notice !== '' && <Alert type="success" message={ notice } />}
    {catalog === undefined && error === '' && <Content loading />}
    {catalog !== undefined && <>
      {catalog.items.length === 0 && <Text type="secondary">{ t('command-center.actions.empty') }</Text>}
      <Grid autoWidth columns={ columns } data={ catalog.items } size="small" />
    </>}
    {editor !== undefined && <FormKit wrapInPanel={ false } formProps={ { disabled: busy } }>
      <FormKit.Panel theme="fieldset" title={ t('command-center.actions.section.general') }>
        <Form.Item label={ t('command-center.templates.label') }>
          <Input value={editor.label} maxLength={120} onChange={event => patch({ label: event.target.value })} />
        </Form.Item>
        <Form.Item label={ t('command-center.actions.target') }>
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
        <Form.Item label={ t('command-center.actions.icon') }>
          <IconSelector value={{ type: editor.iconType ?? 'name', value: editor.icon }}
            onChange={icon => patch({ icon: icon?.value ?? 'play', iconType: icon?.type === 'path' ? 'path' : 'name' })} />
        </Form.Item>
        <Form.Item label={ t('command-center.actions.position') }>
          <Input type="number" value={editor.position} onChange={event => patch({ position: Number(event.target.value) })} />
        </Form.Item>
      </FormKit.Panel>
      <FormKit.Panel theme="fieldset" title={ t('command-center.actions.section.placements') }>
        <Form.Item label={ t('command-center.actions.placements') }>
          <Select mode="multiple" value={editor.placements}
            options={(['global', 'object', 'asset', 'document'] as const).map(value => ({ value, label: t(`command-center.actions.placement.${value}`) }))}
            onChange={(placements: ActionPlacement[]) => patch({ placements })} />
        </Form.Item>
        {editor.placements.includes('object') && <Form.Item label={ t('command-center.actions.classes') }>
          <Select mode="multiple" value={editor.objectClasses} options={catalog?.classes}
            onChange={(objectClasses: string[]) => patch({ objectClasses })} />
        </Form.Item>}
        {editor.placements.some(place => place !== 'global') && <Form.Item label={ t('command-center.actions.element-permission') }>
          <Select value={editor.elementPermission} options={['read', 'write'].map(value => ({ value, label: t(`command-center.actions.permission.${value}`) }))}
            onChange={(elementPermission: 'read' | 'write') => patch({ elementPermission })} />
        </Form.Item>}
      </FormKit.Panel>
      <FormKit.Panel theme="fieldset" title={ t('command-center.actions.section.grants') }>
        <Form.Item label={ t('command-center.actions.users') }>
          <Select mode="multiple" showSearch optionFilterProp="label" value={editor.userIds} options={catalog?.users}
            onChange={(userIds: number[]) => patch({ userIds })} />
        </Form.Item>
        <Form.Item label={ t('command-center.actions.roles') }>
          <Select mode="multiple" showSearch optionFilterProp="label" value={editor.roleIds} options={catalog?.roles}
            onChange={(roleIds: number[]) => patch({ roleIds })} />
        </Form.Item>
        <Text type="secondary">{ t('command-center.actions.help') }</Text>
        {editor.userIds.length === 0 && editor.roleIds.length === 0 &&
          <Text type="warning">{ t('command-center.actions.warn-grants') }</Text>}
      </FormKit.Panel>
      {(target?.fields ?? []).length > 0 && <FormKit.Panel theme="fieldset" title={ t('command-center.actions.fields') }>
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
      </FormKit.Panel>}
      <FormKit.Panel theme="fieldset" title={ t('command-center.actions.section.output') }>
        <Form.Item label={ t('command-center.actions.enabled') }><Switch checked={editor.enabled} onChange={enabled => patch({ enabled })} /></Form.Item>
        {!editor.enabled && <Text type="warning">{ t('command-center.actions.warn-disabled') }</Text>}
        <Form.Item label={ t('command-center.actions.direct') }><Switch checked={editor.direct} onChange={direct => patch({ direct })} /></Form.Item>
        <Form.Item label={ t('command-center.actions.show-output') }><Switch checked={editor.showOutput} onChange={showOutput => patch({ showOutput })} /></Form.Item>
      </FormKit.Panel>
      <Box margin={ { top: 'normal' } }>
        <Flex gap={ 12 } align="center">
          <Button type="primary" disabled={busy || editor.label.trim() === '' || editor.targetId === '' || editor.placements.length === 0}
            onClick={() => { void submit(editor, false) }}>{t('command-center.actions.save')}</Button>
          {editor.id !== undefined && <Button danger disabled={busy} onClick={() => confirmDelete(editor)}>{t('command-center.actions.delete')}</Button>}
          <Button disabled={busy} onClick={() => { setEditor(undefined) }}>{t('command-center.templates.cancel')}</Button>
          {(editor.label.trim() === '' || editor.targetId === '' || editor.placements.length === 0) &&
            <Text type="secondary">{ t('command-center.actions.save-blocked') }</Text>}
        </Flex>
      </Box>
    </FormKit>}
  </Flex>
}
