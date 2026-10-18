import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { setImmediate } from 'node:timers/promises'
import React from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import ts from 'typescript'

const root = new URL('../js/src/', import.meta.url)
const compile = (file, imports, globals = {}) => {
  const exports = {}
  const source = readFileSync(new URL(file, root), 'utf8')
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true }
  }).outputText, {
    exports, require: name => {
      if (name === 'react') return React
      if (name in imports) return imports[name]
      throw new Error(`Unexpected import: ${name}`)
    }, AbortController, TextDecoder, setTimeout, clearTimeout, ...globals
  })
  return exports
}
const slots = []
const registration = compile('modules/command-center.ts', {
  '@pimcore/studio-ui-bundle': { container: { get: id => id === 'registry'
    ? { registerToSlot: (slot, config) => slots.push({ slot, config }) }
    : { registerWidget: () => {}, registerMainNavItem: () => {} } } },
  '@pimcore/studio-ui-bundle/app': { serviceIds: { 'App/ComponentRegistry/ComponentRegistry': 'registry' } },
  '../components/command-center/command-center': { CommandCenter: () => null },
  '../components/command-center/studio-action-buttons': {
    GlobalActionButtons: () => null, ObjectActionButtons: () => null,
    AssetActionButtons: () => null, DocumentActionButtons: () => null
  }
})
registration.CommandCenterModule.onInit()
assert.deepEqual(slots.map(item => item.slot), [
  'leftSidebar.slot', 'dataObject.editor.toolbar.slots.right',
  'asset.editor.toolbar.slots.right', 'document.editor.toolbar.slots.right'
])

const app = { useTranslation: () => ({ t: key => key }) }
const components = new Proxy({}, { get: (_, name) => name })
const buttonImports = {
  '@pimcore/studio-ui-bundle/app': app,
  '@pimcore/studio-ui-bundle/components': components,
  '@pimcore/studio-ui-bundle/modules/data-object': { useDataObject: () => ({ id: 11 }) },
  '@pimcore/studio-ui-bundle/modules/asset': { useAsset: () => ({ id: 12 }) },
  '@pimcore/studio-ui-bundle/modules/document': { useDocument: () => ({ id: 13 }) },
  './studio-actions-api': {}, './studio-action-dialog': {}
}
const wrappers = compile('components/command-center/studio-action-buttons.tsx', buttonImports)
for (const [component, type, id] of [
  ['ObjectActionButtons', 'object', 11], ['AssetActionButtons', 'asset', 12], ['DocumentActionButtons', 'document', 13]
]) {
  const tree = wrappers[component]()
  assert.equal(tree.props.placement, type)
  assert.equal(tree.props.context.type, type)
  assert.equal(tree.props.context.id, id)
  assert.equal('path' in tree.props.context, false)
}
assert.equal(wrappers.GlobalActionButtons().props.placement, 'global')

// Exercise preparation, stale previews, redacted results and direct start through the actual dialog.
const hooks = []
let cursor = 0, effects = [], delayedPreview
const cleanups = []
const dispatcher = {
  useState(initial) {
    const index = cursor++
    if (!(index in hooks)) hooks[index] = initial
    return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value }]
  },
  useRef(initial) {
    const index = cursor++
    hooks[index] ??= { current: initial }
    return hooks[index]
  },
  useEffect(effect, dependencies) {
    const index = cursor++
    if (hooks[index] === undefined || dependencies.some((value, position) => !Object.is(value, hooks[index][position]))) {
      effects.push(effect); hooks[index] = dependencies
    }
  }
}
const calls = []
let direct = false, runResult
const api = compile('components/command-center/studio-actions-api.ts', {
  './api': { commandCenterUrl: path => path }
}, { fetch: async (path, options) => {
    path = path.replace('actions/', '')
    const body = options.body === undefined ? undefined : JSON.parse(options.body)
    calls.push({ path, body })
    if (path === 'prepare') return { ok: true, json: async () => ({
      id: 'action', label: 'Approved', targetType: 'template', direct, previewSupported: true,
      fields: [{ name: 'target', label: 'Target', type: 'string', required: true }], bound: []
    }) }
    if (path === 'preview') return { ok: true, json: async () => delayedPreview ?? { supported: true, count: 1 } }
    if (path === 'run') {
      if (typeof runResult === 'number') return { ok: false, status: runResult }
      if (runResult === 'network') throw new Error('network')
      let delivered = false
      return { ok: true, status: 200, headers: { get: () => 'application/x-ndjson' }, body: { getReader: () => ({ read: async () => {
        if (delivered) return { done: true }
        delivered = true
        return { done: false, value: new TextEncoder().encode('{"type":"run","id":"own-run"}\n{"type":"exit","code":0}\n') }
      } }) } }
    }
    throw new Error(`Unexpected action request: ${path}`)
} })
const dialog = compile('components/command-center/studio-action-dialog.tsx', {
  '@pimcore/studio-ui-bundle/app': app,
  '@pimcore/studio-ui-bundle/components': components,
  './input-fields': { InputFields: 'InputFields' }, './output': { Output: 'Output' },
  './step-list': { StepList: 'StepList' },
  './workflow-run': { statusColor: status => status === 'success' ? 'success'
    : status === 'failed' ? 'error' : ['queued', 'running'].includes(status) ? 'processing' : 'default' },
  './studio-actions-api': api
})
const request = { id: 'action', revision: 1, targetRevision: 1, placement: 'object', context: { type: 'object', id: 11 }, csrfToken: 'csrf' }
const render = () => {
  cursor = 0
  const internal = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher
  const previous = internal.current
  internal.current = dispatcher
  let tree
  try { tree = dialog.StudioActionDialog({ request, onClose: () => {} }) } finally { internal.current = previous }
  const queued = effects; effects = []
  for (const effect of queued) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup) }
  return tree
}
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes)
  : React.isValidElement(tree) ? [tree, ...nodes(tree.props.children), ...nodes(tree.props.footer)] : []
const button = (tree, key) => nodes(tree).find(node => node.type === 'Button' && node.props.children === key)
const field = tree => nodes(tree).find(node => node.type === 'InputFields')
const settle = async () => { await setImmediate(); await setImmediate() }
render(); await settle()
let tree = render()
assert.equal(button(tree, 'command-center.ui.execute').props.disabled, true)
field(tree).props.onChange({ target: 'first' })
tree = render()
button(tree, 'command-center.templates.preview').props.onClick(); await settle()
tree = render()
assert.equal(button(tree, 'command-center.ui.execute').props.disabled, false)
let resolvePreview
delayedPreview = new Promise(resolve => { resolvePreview = resolve })
button(tree, 'command-center.templates.preview').props.onClick(); await settle()
field(render()).props.onChange({ target: 'second' }); render()
resolvePreview({ supported: true, count: 999 }); await settle()
tree = render()
assert.equal(button(tree, 'command-center.ui.execute').props.disabled, true, 'Old preview enabled new inputs')
delayedPreview = undefined
button(tree, 'command-center.templates.preview').props.onClick(); await settle()
button(render(), 'command-center.ui.execute').props.onClick(); await settle()
tree = render()
const run = calls.find(call => call.path === 'run')
assert.equal(run.body.values.target, 'second')
assert.equal(run.body.context.id, 11)
assert.equal('command' in run.body, false)
assert.equal(nodes(tree).some(node => node.type === 'Output'), false, 'Status-only run invented output')
assert.equal(nodes(tree).some(node => node.props.role === 'status' && node.props.children === 'command-center.history.status.success'), true)
for (const cleanup of cleanups) cleanup()
hooks.length = 0; effects = []; calls.length = 0; cleanups.length = 0; direct = true
render(); await settle(); render(); await settle(); render()
assert.equal(calls.filter(call => call.path === 'run').length, 1, 'Direct action started more than once')
for (const cleanup of cleanups) cleanup()
// Eine klare Ablehnung stellt das Formular wieder her, ein unklarer Netzwerkfehler sperrt den Dialog.
for (const scenario of [400, 401, 403, 404, 409, 422, 500, 'network']) {
  hooks.length = 0; effects = []; calls.length = 0; cleanups.length = 0; direct = false; runResult = scenario
  render(); await settle()
  field(render()).props.onChange({ target: 'value' })
  button(render(), 'command-center.templates.preview').props.onClick(); await settle()
  button(render(), 'command-center.ui.execute').props.onClick(); await settle()
  tree = render()
  if (typeof scenario === 'number' && scenario < 500) {
    assert.equal(field(tree) !== undefined, true, 'Rejected run kept the form locked')
    assert.equal(button(tree, 'command-center.ui.execute') !== undefined, true, 'Rejected run hid the execute button')
    assert.equal(nodes(tree).some(node => node.type === 'Alert'), true, 'Rejected run stayed silent')
    assert.equal(field(tree).props.values.target, 'value', 'Rejected run lost its inputs')
    field(tree).props.onChange({ target: 'corrected' })
    runResult = undefined
    button(render(), 'command-center.templates.preview').props.onClick(); await settle()
    button(render(), 'command-center.ui.execute').props.onClick(); await settle()
    assert.equal(calls.filter(call => call.path === 'run').length, 2, 'Corrected inputs could not be submitted again')
    assert.equal(nodes(render()).some(node => node.props.role === 'status' && node.props.children === 'command-center.history.status.success'), true)

  } else {
    assert.equal(field(tree), undefined, 'Uncertain failure reopened a possibly running action')
    assert.equal(button(tree, 'command-center.ui.execute'), undefined, 'Uncertain failure restored the execute button')
  }
  for (const cleanup of cleanups) cleanup()
}
runResult = undefined
console.log('All toolbar slots, element bindings, preview snapshots, status-only results, direct start and rejected-run recovery checked.')

// Keep permissions in the backend; render no buttons or warning for unavailable actions.
let availableItems = [], availableStatus = 200
const buttonApi = compile('components/command-center/studio-actions-api.ts', {
  './api': { commandCenterUrl: path => path }
}, { fetch: async () => ({
  ok: availableStatus === 200, status: availableStatus,
  json: async () => ({ items: availableItems, csrfToken: 'csrf' })
}) })
const listeners = new Map()
const buttonModule = compile('components/command-center/studio-action-buttons.tsx', {
  ...buttonImports, './studio-actions-api': buttonApi
}, { window: {
  addEventListener: (name, callback) => listeners.set(name, callback),
  removeEventListener: name => listeners.delete(name)
} })
const renderButtons = placement => {
  cursor = 0
  const internal = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher
  const previous = internal.current
  internal.current = dispatcher
  let tree
  try {
    tree = buttonModule.StudioActionButtons({ placement, context: placement === 'global' ? null : { type: placement, id: 11 } })
  } finally { internal.current = previous }
  const queued = effects; effects = []
  for (const effect of queued) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup) }
  return tree
}
for (const placement of ['global', 'object', 'asset', 'document']) {
  for (const status of [200, 401, 403, 500]) {
    hooks.length = 0; effects = []; cleanups.length = 0
    availableItems = []; availableStatus = status
    assert.equal(renderButtons(placement), null, 'Buttons flashed before availability was known')
    await settle()
    if (status === 500) {
      assert.notEqual(renderButtons(placement), null, 'Server error was hidden as a permission denial')
    } else {
      assert.equal(renderButtons(placement), null, 'Unavailable actions left a container or warning')
      availableStatus = 200
      availableItems = [{ id: 'allowed', label: 'Allowed', icon: 'play', revision: 1, targetRevision: 1 }]
      listeners.get('focus')(); await settle()
      assert.equal(nodes(renderButtons(placement)).filter(node => node.type === (placement === 'global' ? 'IconButton' : 'Button')).length, 1)
      availableItems = []
      listeners.get('focus')(); await settle()
      assert.equal(renderButtons(placement), null, 'Revoked actions remained visible after refresh')
    }
    for (const cleanup of cleanups) cleanup()
  }
}
console.log('Empty and denied actions hidden at all four placements; focus refresh and server errors checked.')

// Admin-Oberfläche: Tabelle, Leerzustand, Editor-Sections, Save-Feedback und Delete-Bestätigung.
let adminItems = []
const adminCalls = []
const windowEvents = []
const alertWarnings = []
const adminCatalog = () => ({
  items: adminItems,
  templates: [{ id: 't1', label: 'Template One', fields: [{ name: 'folder', label: 'Folder', type: 'string', required: true }] }],
  workflows: [{ id: 'w1', label: 'Workflow One' }],
  users: [{ value: 1, label: 'Admin User' }], roles: [{ value: 2, label: 'Editors' }],
  classes: [{ value: '12', label: 'Object' }],
  csrfToken: 'csrf'
})
const adminApi = compile('components/command-center/studio-actions-api.ts', {
  './api': { commandCenterUrl: path => path }
}, { fetch: async (path, options = {}) => {
  path = path.replace('actions/', '')
  const body = options.body === undefined ? undefined : JSON.parse(options.body)
  adminCalls.push({ path, body })
  if (path === 'admin') return { ok: true, json: async () => adminCatalog() }
  if (path === 'save') return { ok: true, json: async () => body }
  if (path === 'delete') return { ok: true, json: async () => ({}) }
  throw new Error(`Unexpected admin request: ${path}`)
} })
const stubComponent = name => { const fn = () => null; fn.displayName = name; return fn }
const FormKitStub = stubComponent('FormKit'); FormKitStub.Panel = stubComponent('Panel')
const FormStub = stubComponent('Form'); FormStub.Item = stubComponent('Item')
const adminComponents = new Proxy({}, { get: (_, name) => {
  if (name === 'useAlertModal') return () => ({ warn: props => { alertWarnings.push(props); return {} } })
  if (name === 'FormKit') return FormKitStub
  if (name === 'Form') return FormStub
  return name
} })
const adminModule = compile('components/command-center/studio-actions.tsx', {
  '@pimcore/studio-ui-bundle/app': app,
  '@pimcore/studio-ui-bundle/components': adminComponents,
  '@tanstack/react-table': { createColumnHelper },
  './studio-actions-api': adminApi
}, { window: { dispatchEvent: event => windowEvents.push(event.type) }, Event })
const renderAdmin = () => {
  cursor = 0
  const internal = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher
  const previous = internal.current
  internal.current = dispatcher
  let tree
  try { tree = adminModule.StudioActions({ active: true }) } finally { internal.current = previous }
  const queued = effects; effects = []
  for (const effect of queued) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup) }
  return tree
}
const labeled = (tree, label) => nodes(tree).find(node => node.props?.label === label)?.props.children

// Lade- und Leerzustand.
hooks.length = 0; effects = []; cleanups.length = 0; adminCalls.length = 0; windowEvents.length = 0; alertWarnings.length = 0
adminItems = []
let adminTree = renderAdmin()
assert.equal(nodes(adminTree).some(node => node.type === 'Content'), true, 'Admin view skipped its loading state')
await settle()
adminTree = renderAdmin()
assert.equal(nodes(adminTree).some(node => node.type === 'Grid'), true, 'Admin table missing')
assert.equal(nodes(adminTree).some(node => node.props?.children === 'command-center.actions.empty'), true, 'Empty catalog showed no hint')

// Tabelle mit Zeilendaten, Grants-Zusammenfassung und Speichern einer neuen Aktion.
adminItems = [{
  id: 'a1', revision: 1, label: 'Existing', icon: 'play', position: 0, enabled: true,
  targetType: 'template', targetId: 't1', placements: ['global'], userIds: [1], roleIds: [],
  objectClasses: [], elementPermission: 'write', direct: false, showOutput: false, bindings: {}
}]
hooks.length = 0; effects = []; cleanups.length = 0; adminCalls.length = 0
renderAdmin(); await settle()
adminTree = renderAdmin()
const grid = nodes(adminTree).find(node => node.type === 'Grid')
assert.equal(grid.props.data.length, 1, 'Admin table lost its rows')
const cellOf = (tree, id, item) => nodes(tree).find(node => node.type === 'Grid').props.columns
  .find(column => column.id === id).cell({ row: { original: item } })
assert.equal(nodes(cellOf(adminTree, 'label', adminItems[0])).some(node => node.type === 'Icon'), true, 'Action label lost its icon')
assert.equal(nodes(cellOf(adminTree, 'grants', adminItems[0])).some(node => node.type === 'Text' && node.props?.children === 'Admin User'), true, 'Grants column missed the user label')
assert.equal(nodes(cellOf(adminTree, 'placements', adminItems[0])).some(node => node.type === 'Tag'), true, 'Placements column lost its tags')
assert.equal(nodes(adminTree).some(node => node.props?.children === 'command-center.actions.empty'), false, 'Empty hint stayed after items arrived')

button(adminTree, 'command-center.actions.new').props.onClick()
adminTree = renderAdmin()
assert.equal(nodes(adminTree).some(node => node.type === FormKitStub), true, 'New action did not open the editor')
assert.equal(button(adminTree, 'command-center.actions.save').props.disabled, true, 'Save was enabled without label, target and placements')
const blockedHint = treeValue => nodes(treeValue).some(node => node.props?.children === 'command-center.actions.save-blocked')
assert.equal(blockedHint(adminTree), true, 'Blocked save did not explain why')
assert.equal(nodes(adminTree).some(node => node.props?.children === 'command-center.actions.warn-grants'), true, 'Missing grants stayed unmarked')
assert.equal(nodes(adminTree).some(node => node.props?.children === 'command-center.actions.warn-disabled'), true, 'Disabled action stayed unmarked')
labeled(adminTree, 'command-center.templates.label').props.onChange({ target: { value: 'Fresh' } })
labeled(adminTree, 'command-center.actions.target').props.onChange('template:t1')
adminTree = renderAdmin()
assert.equal(button(adminTree, 'command-center.actions.save').props.disabled, true, 'Save ignored missing placements')
assert.equal(blockedHint(adminTree), true, 'Partial action lost the blocked hint')
labeled(adminTree, 'command-center.actions.placements').props.onChange(['object'])
labeled(adminTree, 'command-center.actions.enabled').props.onChange(true)
labeled(adminTree, 'command-center.actions.users').props.onChange([1])
adminTree = renderAdmin()
const saveButton = button(adminTree, 'command-center.actions.save')
assert.equal(saveButton.props.disabled, false, 'Valid action could not be saved')
assert.equal(blockedHint(adminTree), false, 'Valid action still showed the blocked hint')
assert.equal(nodes(adminTree).some(node => node.props?.children === 'command-center.actions.warn-disabled'), false, 'Enabled action kept the disabled warning')
assert.equal(nodes(adminTree).some(node => node.props?.children === 'command-center.actions.warn-grants'), false, 'Granted action kept the grants warning')
saveButton.props.onClick(); await settle()
const savedCall = adminCalls.find(call => call.path === 'save')
assert.equal(savedCall.body.label, 'Fresh', 'Save sent the wrong label')
assert.equal(savedCall.body.csrfToken, 'csrf', 'Save omitted the CSRF token')
assert.equal(savedCall.body.placements[0], 'object', 'Save lost the placements')
assert.equal(windowEvents.includes(adminApi.actionsChanged), true, 'Toolbar buttons were not notified')
await settle()
adminTree = renderAdmin()
assert.equal(button(adminTree, 'command-center.actions.save'), undefined, 'Editor stayed open after saving')
assert.equal(nodes(adminTree).some(node => node.type === 'Alert' && node.props.type === 'success'), true, 'Saving stayed silent')

// Löschen erst nach der Bestätigung, aus der Zeilen-Aktion heraus.
alertWarnings.length = 0; adminCalls.length = 0
const rowDelete = nodes(cellOf(adminTree, 'actions', adminItems[0]))
  .find(node => node.type === 'Button' && node.props.danger === true && node.props.children === 'command-center.ui.delete')
rowDelete.props.onClick()
assert.equal(alertWarnings.length, 1, 'Delete ran without confirmation')
assert.equal(alertWarnings[0].content, 'command-center.actions.delete-confirm', 'Delete confirmation lost its message')
alertWarnings[0].onOk(); await settle()
const deleteCall = adminCalls.find(call => call.path === 'delete')
assert.equal(deleteCall !== undefined, true, 'Confirmed delete did not reach the API')
assert.equal(deleteCall.body.id, 'a1', 'Delete sent the wrong id')
for (const cleanup of cleanups) cleanup()
console.log('Admin listing, empty state, section editor, save feedback and confirmed delete checked.')
