import React, { forwardRef } from 'react'
import { useTranslation } from '@pimcore/studio-ui-bundle/app'
import { useStyles } from './output.styles'

export interface OutputProps {
  text?: string
  label?: string
  minHeight?: number
  maxHeight?: number
  grow?: boolean
}

export const Output = forwardRef<HTMLPreElement, OutputProps>(({ text, label, minHeight, maxHeight, grow }, ref) => {
  const { t } = useTranslation()
  const { styles } = useStyles({ minHeight, maxHeight, grow })

  return (
    <pre ref={ ref } aria-label={ label ?? t('command-center.ui.output') } className={ styles.output }>
      {text !== undefined && text !== '' ? text : t('command-center.ui.no-output')}
    </pre>
  )
})

Output.displayName = 'Output'
