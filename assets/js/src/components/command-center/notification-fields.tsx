import { useTranslation } from '@pimcore/studio-ui-bundle/app'
import React from 'react'
import { Select } from '@pimcore/studio-ui-bundle/components'

export interface Recipient { id: number, name: string, email: string | null, studioAllowed: boolean }

export const NotificationFields = ({ recipients, ids, channels, onIds, onChannels }: {
  recipients: Recipient[], ids: number[], channels: string[],
  onIds: (ids: number[]) => void, onChannels: (channels: string[]) => void
}): React.JSX.Element => {
  const { t } = useTranslation()
  return (
    <>
      <label>{t('command-center.notify.heading')}</label>
      <Select mode="multiple" aria-label={t('command-center.notify.recipients')} value={ ids }
        placeholder={t('command-center.notify.none')} style={ { width: '100%', maxWidth: 'none' } }
        optionFilterProp="label" onChange={ onIds }
        options={ recipients.map(user => ({ value: user.id,
          label: `${user.name}${user.email ? ` (${user.email})` : t('command-center.notify.no-email')}${user.studioAllowed ? '' : t('command-center.notify.no-studio')}` })) } />
      <Select mode="multiple" aria-label={t('command-center.notify.channels')} value={ channels }
        placeholder={t('command-center.notify.choose-channels')} style={ { width: '100%', maxWidth: 'none' } } onChange={ onChannels }
        options={ [{ value: 'email', label: t('command-center.notify.email') }, { value: 'studio', label: t('command-center.notify.studio') }] } />
      <small>{t('command-center.notify.help')}</small>
    </>
  )
}
