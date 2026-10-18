import { createStyles } from '@pimcore/studio-ui-bundle/app'

export interface OutputStyleProps {
  minHeight?: number
  maxHeight?: number
  grow?: boolean
}

export const useStyles = createStyles(({ css, token }, { minHeight, maxHeight, grow }: OutputStyleProps) => ({
  output: css`
    margin: 0;
    padding: ${token.padding}px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadius}px;
    background: ${token.colorBgLayout};
    color: ${token.colorText};
    font-family: ${token.fontFamilyCode};
    font-size: ${token.fontSize}px;
    line-height: ${token.lineHeight};
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    overflow: auto;
    min-height: ${minHeight === undefined ? '0' : `${minHeight}px`};
    max-height: ${maxHeight === undefined ? 'none' : `${maxHeight}px`};
    ${grow === true ? 'flex: 1;' : ''}
  `
}))
