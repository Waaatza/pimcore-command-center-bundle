import React, { useEffect, useState } from 'react'
import { useTranslation } from '@pimcore/studio-ui-bundle/app'
import { Tag } from '@pimcore/studio-ui-bundle/components'
import { commandCenterUrl } from './api'

export const RunningIndicator = (): React.JSX.Element | null => {
  const { t } = useTranslation()
  const [active, setActive] = useState(0)
  useEffect(() => {
    const abort = new AbortController()
    const load = async (): Promise<void> => {
      try {
        const response = await fetch(commandCenterUrl('history?status=running'), { signal: abort.signal, cache: 'no-store' })
        if (!response.ok) return
        const data = await response.json() as { items: Array<{ active?: boolean }> }
        if (!abort.signal.aborted) setActive(data.items.filter(item => item.active).length)
      } catch { /* keep the last known count */ }
    }
    void load()
    const interval = window.setInterval(() => { void load() }, 5000)
    return () => { abort.abort(); window.clearInterval(interval) }
  }, [])
  if (active === 0) return null
  return <Tag color="processing" role="status">{t('command-center.ui.running-count', { count: active })}</Tag>
}
