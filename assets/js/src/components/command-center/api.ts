import { getPrefix } from '@pimcore/studio-ui-bundle/api'

export const commandCenterUrl = (path: string): string => `${getPrefix()}/command-center/${path}`
