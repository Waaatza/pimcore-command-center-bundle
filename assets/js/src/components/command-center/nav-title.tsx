import React, { useEffect, useState } from 'react'
import { useTranslation } from '@pimcore/studio-ui-bundle/app'
import { Icon, Space, Tag } from '@pimcore/studio-ui-bundle/components'
import { commandCenterUrl } from './api'

interface RunBadge {
  status: string
  active?: boolean
}

export const CommandCenterNavTitle = (): React.JSX.Element => {
  const { t } = useTranslation()
  const [active, setActive] = useState(0)
  useEffect(() => {
    const abort = new AbortController()
    const load = async (): Promise<void> => {
      try {
        const response = await fetch(commandCenterUrl('history?status=running'), { signal: abort.signal, cache: 'no-store' })
        if (!response.ok) return
        const data = await response.json() as { items: RunBadge[] }
        if (!abort.signal.aborted) setActive(data.items.filter(item => item.active).length)
      } catch { /* keep the last known count */ }
    }
    void load()
    const interval = window.setInterval(() => { void load() }, 5000)
    return () => { abort.abort(); window.clearInterval(interval) }
  }, [])
  return <Space size="small">
    <Icon value="accessory" />
    <span>{t('command-center.title')}</span>
    {active > 0 && <Tag color="processing" role="status">{active}</Tag>}
  </Space>
}
