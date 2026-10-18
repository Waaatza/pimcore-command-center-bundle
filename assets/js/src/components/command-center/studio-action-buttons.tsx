import React, { useEffect, useState } from 'react'
import { useTranslation } from '@pimcore/studio-ui-bundle/app'
import { Alert, Button, Flex, Icon, IconButton } from '@pimcore/studio-ui-bundle/components'
import { useDataObject } from '@pimcore/studio-ui-bundle/modules/data-object'
import { useAsset } from '@pimcore/studio-ui-bundle/modules/asset'
import { useDocument } from '@pimcore/studio-ui-bundle/modules/document'
import { actionFetch, actionsChanged, type ActionContext, type ActionMeta, type ActionPlacement, type ActionRequest } from './studio-actions-api'
import { StudioActionDialog } from './studio-action-dialog'

export const StudioActionButtons = ({ placement, context = null }: {
  placement: ActionPlacement, context?: ActionContext | null
}): React.JSX.Element => {
  const { t } = useTranslation()
  const [items, setItems] = useState<ActionMeta[]>([])
  const [csrfToken, setCsrfToken] = useState('')
  const [request, setRequest] = useState<ActionRequest>()
  const [error, setError] = useState(false)
  const contextKey = JSON.stringify(context)
  useEffect(() => {
    let abort: AbortController | undefined
    const load = (): void => {
      abort?.abort()
      if (placement !== 'global' && context === null) { setItems([]); return }
      abort = new AbortController()
      const current = abort
      void actionFetch('available', { placement, context }, abort.signal).then(async response => {
        const data = await response.json() as { items: ActionMeta[], csrfToken: string }
        if (!current.signal.aborted) { setItems(data.items); setCsrfToken(data.csrfToken); setError(false) }
      }).catch(() => { if (!current.signal.aborted) { setItems([]); setError(true) } })
    }
    load()
    window.addEventListener('focus', load)
    window.addEventListener(actionsChanged, load)
    return () => {
      abort?.abort()
      window.removeEventListener('focus', load)
      window.removeEventListener(actionsChanged, load)
    }
  }, [placement, contextKey])

  const choose = (action: ActionMeta): void => setRequest({
    csrfToken, id: action.id, revision: action.revision, targetRevision: action.targetRevision, placement, context
  })
  return <>
    <Flex vertical={placement === 'global'} gap={8} wrap>
      {error && <Alert type="error" message={t('command-center.actions.error')} />}
      {items.map(action => placement === 'global'
        ? <IconButton key={action.id} icon={{ value: action.icon, type: action.iconType ?? 'name' }} aria-label={action.label}
            tooltip={{ title: action.label }} onClick={() => choose(action)} />
        : <Button key={action.id} icon={<Icon value={action.icon} type={action.iconType ?? 'name'} />} onClick={() => choose(action)}>{action.label}</Button>)}
    </Flex>
    {request !== undefined && <StudioActionDialog request={request} onClose={() => setRequest(undefined)} />}
  </>
}

export const GlobalActionButtons = (): React.JSX.Element => <StudioActionButtons placement="global" />
export const ObjectActionButtons = (): React.JSX.Element => {
  const { id } = useDataObject()
  return <StudioActionButtons placement="object" context={id === undefined ? null : { type: 'object', id }} />
}
export const AssetActionButtons = (): React.JSX.Element => {
  const { id } = useAsset()
  return <StudioActionButtons placement="asset" context={id === undefined ? null : { type: 'asset', id }} />
}
export const DocumentActionButtons = (): React.JSX.Element => {
  const { id } = useDocument()
  return <StudioActionButtons placement="document" context={id === undefined ? null : { type: 'document', id }} />
}
