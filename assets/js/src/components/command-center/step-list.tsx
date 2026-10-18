import React from 'react'
import { stepListStyle } from './step-list.styles'

export const StepList = ({ items }: { items: React.ReactNode[] }): React.JSX.Element => {
  return (
    <ol style={ stepListStyle }>
      {items.map((item, index) => <li key={ index }>{item}</li>)}
    </ol>
  )
}
