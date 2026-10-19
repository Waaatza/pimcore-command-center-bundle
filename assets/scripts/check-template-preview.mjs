import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setImmediate } from 'node:timers/promises'
import { runInNewContext } from 'node:vm'
import React from 'react'
import ts from 'typescript'
import { createColumnHelper } from '@tanstack/react-table'

// Exercise the component's state and requests without mounting the Studio shell.
const hooks = []
let cursor = 0
let effects = []
const dispatcher = {
  useState(initial) {
    const index = cursor++
    if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
    return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value }]
  },
  useRef(initial) {
    const index = cursor++
    hooks[index] ??= { current: initial }
    return hooks[index]
  },
  useEffect(effect, dependencies) {
    const index = cursor++
    const old = hooks[index]
    if (old === undefined || dependencies.some((value, position) => !Object.is(value, old[position]))) {
      effects.push(effect)
      hooks[index] = dependencies
    }
  }
}
const components = new Proxy({
  Form: { useForm: () => [{ getFieldsValue: () => ({ fields: [] }) }], useWatch: () => undefined, Item: 'Form.Item' }
}, { get: (target, name) => {
  if (name === 'useAlertModal') return () => ({ warn: props => { deleteWarnings.push(props); return {} } })
  return target[name] ?? name
} })
let revision = 1
let pendingPreview, savedTemplate, deletedTemplate, ranTemplate
let previewSupported = true
let fieldCount = 0
let templateItems = () => [{
  id: 'template', revision, label: 'Rename', command: 'test:rename', description: '', tokens: [], previewSupported,
  fields: Array.from({ length: fieldCount }, (_, index) => ({ name: `field${index}`, label: `Field ${index}`, type: 'string', required: true }))
}]
const deleteWarnings = []
const exports = {}
const source = readFileSync(new URL('../js/src/components/command-center/command-templates.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true }
}).outputText
runInNewContext(compiled, {
  exports,
  require: name => {
    if (name === 'react') return React
    if (name === '@pimcore/studio-ui-bundle/app') return { useTranslation: () => ({ t: key => key }) }
    if (name === '@pimcore/studio-ui-bundle/components') return components
    if (name === '@tanstack/react-table') return { createColumnHelper }
    if (name === './api') return { commandCenterUrl: path => path }
    if (name === './grid-cell') return { padCells: columns => columns }
    if (name === './command-templates.styles') return { tooltipButtonStyle: { display: 'inline-flex' } }
    if (name === './input-fields') return { InputFieldEditor: 'InputFieldEditor' }
    if (name === './output') return { Output: 'Output' }
    throw new Error(`Unexpected import: ${name}`)
  },
  AbortController, window: { setTimeout: callback => callback() }, TextDecoder, TextEncoder,
  fetch: async (path, options) => {
    if (path === 'templates/save') {
      savedTemplate = JSON.parse(options.body)
      return { ok: true, json: async () => ({ ...savedTemplate, id: 'template', revision: 1 }) }
    }
    if (path === 'templates/delete') {
      deletedTemplate = JSON.parse(options.body)
      return { ok: true, json: async () => ({}) }
    }
    if (path === 'templates/run') {
      ranTemplate = JSON.parse(options.body)
      return { ok: true, json: async () => ({ id: 'run-id', status: 'queued' }) }
    }
    if (path.startsWith('history/')) return { ok: true, json: async () => ({
      id: path.split('/')[1], status: 'success', output: 'ran', exitCode: 0, error: null
    }) }
    if (path === 'templates/preview') return { ok: true, json: async () => pendingPreview ?? { supported: true, count: 1, samples: [] } }
    return ({
    ok: true,
    json: async () => {
      if (path === 'templates') return { items: templateItems() }
      if (path === 'list') return { commands: [{ name: 'test:rename' }], csrfToken: 'token' }
      throw new Error(`Unexpected request: ${path}`)
    }
  })
  }
})
const render = (active = true) => {
  cursor = 0
  const internal = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher
  const previous = internal.current
  internal.current = dispatcher
  let tree
  try { tree = exports.CommandTemplates({ active, draft: {} }) } finally { internal.current = previous }
  const queued = effects
  effects = []
  queued.forEach(effect => effect())
  return tree
}
const nodes = tree => {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!React.isValidElement(tree)) return []
  return [tree, ...nodes(tree.props.children), ...nodes(tree.props.footer)]
}
const button = (tree, key) => nodes(tree).find(node => node.type === 'Button' && node.props.children === key)
const rowItem = (tree, index = 0) => nodes(tree).find(node => node.type === 'Grid').props.data[index]
const cellOf = (tree, id) => nodes(tree).find(node => node.type === 'Grid').props.columns
  .find(column => column.id === id).cell({ row: { original: rowItem(tree) } })
const rowButton = (tree, id, key) => nodes(cellOf(tree, id)).find(node => node.type === 'Button' && node.props.children === key)
const settle = async () => { await setImmediate(); await setImmediate() }
const checkBlocked = tree => {
  assert.equal(button(tree, 'command-center.ui.execute').props.disabled, true)
  assert.equal(nodes(tree).some(node => node.props.children === 'command-center.templates.preview-count'), false)
}

render()
await settle()
const tableTree = render()
assert.equal(nodes(tableTree).some(node => node.type === 'Grid'), true, 'Template table missing')
assert.equal(nodes(cellOf(tableTree, 'preview')).some(node => node.type === 'Tag'), true, 'Preview column lost its tag')
rowButton(tableTree, 'actions', 'command-center.ui.details').props.onClick()
button(render(), 'command-center.templates.preview').props.onClick()
await settle()
assert.equal(button(render(), 'command-center.ui.execute').props.disabled, false)
render(false)
render()
await settle()
assert.equal(button(render(), 'command-center.ui.execute').props.disabled, false, 'Unchanged revision lost its preview')
revision = 2
render(false)
render()
await settle()
checkBlocked(render())

let resolvePreview
pendingPreview = new Promise(resolve => { resolvePreview = resolve })
button(render(), 'command-center.templates.preview').props.onClick()
await settle()
revision = 3
render(false)
render()
await settle()
resolvePreview({ supported: true, count: 99, samples: [] })
await settle()
checkBlocked(render())
pendingPreview = undefined
button(render(), 'command-center.templates.preview').props.onClick()
await settle()
assert.equal(button(render(), 'command-center.ui.execute').props.disabled, false, 'Fresh preview did not unlock execution')
console.log('Template preview revision and delayed-response checks passed.')

rowButton(render(), 'actions', 'command-center.ui.edit').props.onClick()
let editorTree = render()
const commandSelect = tree => nodes(tree).find(node => node.type === 'Select' && node.props.showSearch === true)
commandSelect(editorTree).props.onChange('pimcore:run-script')
editorTree = render()
const phpField = tree => nodes(tree).find(node => node.type === 'TextArea' && node.props.spellCheck === false)
assert.notEqual(phpField(editorTree), undefined, 'Script template has no PHP field')
phpField(editorTree).props.onChange({ target: { value: 'echo "template";' } })
button(render(), 'command-center.templates.save').props.onClick(); await settle()
assert.equal(savedTemplate.phpCode, 'echo "template";', 'Template save lost PHP source')
rowButton(render(), 'actions', 'command-center.ui.edit').props.onClick()
commandSelect(render()).props.onChange('pimcore:run-script')
phpField(render()).props.onChange({ target: { value: 'echo "discard";' } })
commandSelect(render()).props.onChange('test:rename')
assert.equal(phpField(render()), undefined, 'PHP field remained after command switch')
button(render(), 'command-center.templates.save').props.onClick(); await settle()
assert.equal(savedTemplate.phpCode, null, 'Non-script template retained PHP source')
console.log('Template PHP editor, save payload and command-switch cleanup checked.')

// Der Listen-Start ist immer sichtbar: bei Vorlagen mit Vorschau deaktiviert mit Tooltip.
const previewRun = rowButton(render(), 'actions', 'command-center.ui.execute')
assert.equal(previewRun.props.disabled, true, 'Preview template offered a direct row run')
assert.equal(nodes(cellOf(render(), 'actions')).some(node => node.type === 'Tooltip' && node.props.title === 'command-center.templates.run-preview-hint'), true, 'Disabled row run lost its preview tooltip')
previewSupported = false
render(false)
render()
await settle()
let directTree = render()
assert.equal(rowButton(directTree, 'actions', 'command-center.ui.execute').props.disabled, false, 'Preview-less template could not run from the list')
rowButton(directTree, 'actions', 'command-center.ui.execute').props.onClick()
await settle()
assert.equal(ranTemplate.id, 'template', 'Row run sent the wrong template')
render(); await settle()
assert.equal(nodes(render()).some(node => node.type === 'Output' && String(node.props.text).includes('ran')), true, 'Row run did not show its output')

// Vorlagen mit Eingabefeldern bleiben listen-deaktiviert und verweisen auf die Details.
fieldCount = 1
render(false)
render()
await settle()
directTree = render()
assert.equal(rowButton(directTree, 'actions', 'command-center.ui.execute').props.disabled, true, 'Template with fields offered a direct row run')
assert.equal(nodes(cellOf(directTree, 'actions')).some(node => node.type === 'Tooltip' && node.props.title === 'command-center.templates.run-fields-hint'), true, 'Field template lost its input tooltip')
console.log('Template row run, disabled hints and tooltips checked.')

deleteWarnings.length = 0
rowButton(render(), 'actions', 'command-center.ui.delete').props.onClick()
assert.equal(deleteWarnings.length, 1, 'Template delete ran without confirmation')
assert.equal(deleteWarnings[0].content, 'command-center.templates.delete-confirm', 'Template delete confirmation lost its message')
deleteWarnings[0].onOk(); await settle()
assert.equal(deletedTemplate.id, 'template', 'Confirmed template delete sent the wrong id')
assert.equal(deletedTemplate.revision !== undefined, true, 'Confirmed template delete dropped the revision')
templateItems = () => []
render(false)
render()
await settle()
assert.equal(nodes(render()).some(node => node.props?.children === 'command-center.templates.empty'), true, 'Empty template list showed no hint')
console.log('Template row actions, confirmed delete and empty state checked.')
