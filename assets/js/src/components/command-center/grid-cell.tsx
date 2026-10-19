import React from 'react'
import type { CellContext, ColumnDef } from '@tanstack/react-table'
import { cellContentStyle } from './grid-cell.styles'

export const padCells = (columns: ColumnDef<any, any>[]): ColumnDef<any, any>[] =>
  columns.map(column => {
    const cell = column.cell
    if (typeof cell !== 'function') {
      return column
    }
    return {
      ...column,
      cell: (context: CellContext<any, any>) => <div style={ cellContentStyle }>{ cell(context) }</div>
    }
  })
