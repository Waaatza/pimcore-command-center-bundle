import React from 'react'
import { Select } from '@pimcore/studio-ui-bundle/components'

export interface Recipient { id: number, name: string, email: string | null, studioAllowed: boolean }

export const NotificationFields = ({ recipients, ids, channels, onIds, onChannels }: {
  recipients: Recipient[], ids: number[], channels: string[],
  onIds: (ids: number[]) => void, onChannels: (channels: string[]) => void
}): React.JSX.Element => (
  <>
    <label>Bei Fehlern benachrichtigen</label>
    <Select mode="multiple" aria-label="Empfänger für Fehlerbenachrichtigungen" value={ ids }
      placeholder="Keine Benachrichtigung" style={ { width: '100%', maxWidth: 'none' } }
      optionFilterProp="label" onChange={ onIds }
      options={ recipients.map(user => ({ value: user.id,
        label: `${user.name}${user.email ? ` (${user.email})` : ' (ohne E-Mail)'}${user.studioAllowed ? '' : ' · keine Studio-Benachrichtigungen'}` })) } />
    <Select mode="multiple" aria-label="Benachrichtigungskanäle" value={ channels }
      placeholder="Kanäle auswählen" style={ { width: '100%', maxWidth: 'none' } } onChange={ onChannels }
      options={ [{ value: 'email', label: 'E-Mail' }, { value: 'studio', label: 'Studio-Benachrichtigung' }] } />
    <small>E-Mail benötigt einen konfigurierten Mailversand und eine gültige Nutzeradresse.
      Studio-Benachrichtigungen benötigen die Berechtigung „notifications“.</small>
  </>
)
