import React from 'react'
import { useStyles } from './step-list.styles'

export const StepList = ({ items }: { items: React.ReactNode[] }): React.JSX.Element => {
  const { styles } = useStyles()

  return (
    <ol className={ styles.list }>
      {items.map((item, index) => <li key={ index }>{item}</li>)}
    </ol>
  )
}
