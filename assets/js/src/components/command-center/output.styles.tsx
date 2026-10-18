import type { CSSProperties } from 'react'

export interface OutputStyleProps {
  minHeight?: number
  maxHeight?: number
  grow?: boolean
}

export const outputStyle = ({ minHeight, maxHeight, grow }: OutputStyleProps): CSSProperties => ({
  margin: 0,
  padding: 16,
  border: '1px solid #8886',
  borderRadius: 6,
  background: '#111827',
  color: '#e5e7eb',
  fontFamily: 'monospace',
  fontSize: 14,
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  overflow: 'auto',
  minHeight: minHeight === undefined ? 0 : minHeight,
  maxHeight: maxHeight === undefined ? 'none' : maxHeight,
  ...(grow === true ? { flex: 1 } : {})
})
