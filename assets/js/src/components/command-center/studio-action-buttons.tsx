import React, { useEffect, useState } from 'react'
import { useTranslation } from '@pimcore/studio-ui-bundle/app'
import { Alert, Button, Flex, Icon, IconButton, Tooltip } from '@pimcore/studio-ui-bundle/components'
import { useDataObject } from '@pimcore/studio-ui-bundle/modules/data-object'
import { useAsset } from '@pimcore/studio-ui-bundle/modules/asset'
import { useDocument } from '@pimcore/studio-ui-bundle/modules/document'
import { ActionHttpError, actionFetch, actionsChanged, type ActionContext, type ActionMeta, type ActionPlacement, type ActionRequest } from './studio-actions-api'
import { StudioActionDialog } from './studio-action-dialog'

export const StudioActionButtons = ({ placement, context = null }: {
  placement: ActionPlacement, context?: ActionContext | null
}): React.JSX.Element | null => {
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
      }).catch((error: unknown) => {
        if (!current.signal.aborted) {
          setItems([])
          setError(!(error instanceof ActionHttpError && [401, 403].includes(error.status)))
        }
      })
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
  if (items.length === 0 && !error && request === undefined) return null

  return <>
    <Flex vertical={placement === 'global'} align={placement === 'global' ? 'center' : undefined}
      gap={placement === 'global' ? 0 : 8} wrap={placement !== 'global'}>
      {error && (placement === 'global'
        ? <Tooltip title={t('command-center.actions.error')} placement="right">
            <span role="alert" aria-label={t('command-center.actions.error')}><Icon value="warning-circle" /></span>
          </Tooltip>
        : <Alert type="error" message={t('command-center.actions.error')} />)}
      {items.map(action => placement === 'global'
        ? <IconButton key={action.id} icon={{ value: action.icon, type: action.iconType ?? 'name' }} aria-label={action.label}
            type="text" tooltip={{ title: action.label, placement: 'right' }} onClick={() => choose(action)} />
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
