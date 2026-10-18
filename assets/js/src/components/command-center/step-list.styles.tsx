import { createStyles } from '@pimcore/studio-ui-bundle/app'

export const useStyles = createStyles(({ css }) => ({
  list: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding-left: 20px;
  `
}))
