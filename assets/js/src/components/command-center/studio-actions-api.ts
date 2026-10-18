import { commandCenterUrl } from './api'
import type { InputField } from './input-fields'

export type ActionPlacement = 'global' | 'object' | 'asset' | 'document'
export interface ActionContext { type: Exclude<ActionPlacement, 'global'>, id: number }
export interface ActionMeta {
  id: string
  revision: number
  targetRevision: number
  label: string
  icon: string
  iconType?: 'name' | 'path'
  position: number
  direct: boolean
  showOutput: boolean
  targetType: 'template' | 'workflow'
  previewSupported: boolean
}
export interface PreparedAction extends ActionMeta {
  fields: InputField[]
  bound: Array<{ label: string, value: string }>
}
export interface ActionResult {
  id: string
  status: string
  exitCode?: number | null
  output?: string
  steps: Array<{ label: string, status: string }>
}
export interface ActionRequest {
  csrfToken: string
  id: string
  revision: number
  targetRevision: number
  placement: ActionPlacement
  context: ActionContext | null
  values?: Record<string, string>
}

export class ActionHttpError extends Error {
  constructor (public readonly status: number) {
    super(String(status))
  }
}

export const actionsChanged = 'command-center-actions-changed'
export const actionFetch = async (path: string, data?: object, signal?: AbortSignal): Promise<Response> => {
  const response = await fetch(commandCenterUrl(`actions/${path}`), {
    method: data === undefined ? 'GET' : 'POST', cache: 'no-store', signal,
    headers: data === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data)
  })
  if (!response.ok) throw new ActionHttpError(response.status)
  return response
}
