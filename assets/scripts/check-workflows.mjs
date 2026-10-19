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
const formValues = {
  label: 'Nightly',
  description: 'Runs at night',
  steps: [{ label: 'Clean', command: 'test:rename', tokens: '[]', phpCode: null }],
  fields: []
}
const components = new Proxy({
  Form: {
    useForm: () => [{ getFieldsValue: () => formValues, getFieldValue: () => undefined, setFieldValue: () => undefined }],
    useWatch: name => formValues[name],
    Item: 'Form.Item'
  }
}, { get: (target, name) => {
  if (name === 'useAlertModal') return () => ({ warn: props => { deleteWarnings.push(props); return {} } })
  return target[name] ?? name
} })
let revision = 1
let savedWorkflow, deletedWorkflow, ranWorkflow
let fieldCount = 0
let workflowItems = () => [{
  id: 'workflow', revision, label: 'Nightly', description: 'Runs at night',
  steps: [
    { label: 'Clean', command: 'test:rename', tokens: [], phpCode: null },
    { label: 'Index', command: 'test:index', tokens: [], phpCode: null }
  ],
  fields: Array.from({ length: fieldCount }, (_, index) => ({ name: `field${index}`, label: `Field ${index}`, type: 'string', required: true }))
}]
const deleteWarnings = []
const exports = {}
const source = readFileSync(new URL('../js/src/components/command-center/workflows.tsx', import.meta.url), 'utf8')
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
    if (name === './command-templates.styles') return { tooltipButtonStyle: { display: 'inline-flex' } }
    if (name === './input-fields') return { InputFields: 'InputFields', InputFieldEditor: 'InputFieldEditor' }
    if (name === './notification-fields') return { NotificationFields: 'NotificationFields' }
    if (name === './workflow-run') return { WorkflowRunView: 'WorkflowRunView' }
    if (name === './step-list') return { StepList: 'StepList' }
    throw new Error(`Unexpected import: ${name}`)
  },
  AbortController, window: { setTimeout: callback => callback() },
  fetch: async (path, options) => {
    if (path === 'workflows/save') {
      savedWorkflow = JSON.parse(options.body)
      return { ok: true, json: async () => ({ ...savedWorkflow, id: 'workflow', revision: 1 }) }
    }
    if (path === 'workflows/delete') {
      deletedWorkflow = JSON.parse(options.body)
      return { ok: true, json: async () => ({}) }
    }
    if (path === 'workflows/run') {
      ranWorkflow = JSON.parse(options.body)
      return { ok: true, json: async () => ({ id: 'run-1' }) }
    }
    return ({
      ok: true,
      json: async () => {
        if (path === 'workflows') return { items: workflowItems() }
        if (path === 'list') return { commands: [{ name: 'test:rename' }], csrfToken: 'token' }
        if (path === 'schedules') return { recipients: [] }
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
  try { tree = exports.Workflows({ active, draft: {}, onScheduled: () => undefined }) } finally { internal.current = previous }
  const queued = effects
  effects = []
  queued.forEach(effect => effect())
  return tree
}
const nodes = tree => {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!React.isValidElement(tree)) return []
  return [tree, ...nodes(tree.props.children)]
}
const button = (tree, key) => nodes(tree).find(node => node.type === 'Button' && node.props.children === key)
const rowItem = (tree, index = 0) => nodes(tree).find(node => node.type === 'Grid').props.data[index]
const cellOf = (tree, id) => nodes(tree).find(node => node.type === 'Grid').props.columns
  .find(column => column.id === id).cell({ row: { original: rowItem(tree) } })
const rowButton = (tree, id, key) => nodes(cellOf(tree, id)).find(node => node.type === 'Button' && node.props.children === key)
const tooltip = (tree, id) => nodes(cellOf(tree, id)).find(node => node.type === 'Tooltip')
const settle = async () => { await setImmediate(); await setImmediate() }

render()
await settle()
const tableTree = render()
const grid = nodes(tableTree).find(node => node.type === 'Grid')
assert.equal(grid !== undefined, true, 'Workflow table missing')
assert.equal(grid.props.autoWidth, true, 'Workflow table does not span the panel')
assert.equal(grid.props.columns.filter(column => column.meta?.autoWidth === true).length, 1, 'Workflow table needs exactly one flexible column')
assert.equal(cellOf(tableTree, 'steps').props.children, 2, 'Step count column lost its value')
assert.equal(cellOf(tableTree, 'fields').props.children, 0, 'Empty input count is not rendered')
assert.equal(button(tableTree, 'command-center.workflows.new') !== undefined, true, 'New workflow button missing')
for (const key of ['command-center.ui.execute', 'command-center.ui.details', 'command-center.ui.edit', 'command-center.ui.delete']) {
  assert.equal(rowButton(tableTree, 'actions', key) !== undefined, true, `Missing row action ${key}`)
}
console.log('Workflow listing, counts and row actions checked.')

rowButton(render(), 'actions', 'command-center.ui.details').props.onClick()
const detailTree = render()
assert.equal(nodes(detailTree).some(node => node.type === 'Title' && node.props.children === 'Nightly'), true, 'Details did not open the workflow')
assert.equal(button(detailTree, 'command-center.workflows.run') !== undefined, true, 'Details lost the run button')
assert.equal(button(detailTree, 'command-center.workflows.schedule') !== undefined, true, 'Details lost the schedule button')
assert.equal(button(detailTree, 'command-center.workflows.delete'), undefined, 'Details kept the inline delete button')
console.log('Workflow details, run, schedule and removed inline delete checked.')

// Ohne Eingabefelder startet die Zeile direkt und zeigt den Lauf an.
const directTree = render()
assert.equal(rowButton(directTree, 'actions', 'command-center.ui.execute').props.disabled, false, 'Field-less workflow could not run from the list')
assert.equal(tooltip(directTree, 'actions').props.title, undefined, 'Field-less workflow kept a run tooltip')
rowButton(directTree, 'actions', 'command-center.ui.execute').props.onClick()
await settle()
assert.equal(ranWorkflow.id, 'workflow', 'Row run sent the wrong workflow')
assert.equal(ranWorkflow.revision, revision, 'Row run dropped the revision')
assert.deepEqual(ranWorkflow.values, {}, 'Row run sent unexpected input values')
assert.equal(nodes(render()).some(node => node.type === 'WorkflowRunView' && node.props.id === 'run-1'), true, 'Row run did not open the run view')

// Workflows mit Eingabefeldern bleiben listen-deaktiviert und verweisen auf die Details.
fieldCount = 1
render(false)
render()
await settle()
const fieldTree = render()
assert.equal(rowButton(fieldTree, 'actions', 'command-center.ui.execute').props.disabled, true, 'Workflow with fields offered a direct row run')
assert.equal(tooltip(fieldTree, 'actions').props.title, 'command-center.workflows.run-fields-hint', 'Field workflow lost its input tooltip')
assert.equal(Number(cellOf(fieldTree, 'fields').props.children), 1, 'Input count column lost its value')
fieldCount = 0
console.log('Workflow row run, disabled hints and tooltips checked.')

rowButton(render(), 'actions', 'command-center.ui.edit').props.onClick()
assert.equal(nodes(render()).some(node => node.type === 'FormKit'), true, 'Row edit did not open the editor')
button(render(), 'command-center.workflows.save').props.onClick(); await settle()
assert.equal(savedWorkflow.label, 'Nightly', 'Workflow save lost the label')
assert.equal(savedWorkflow.steps.length, 1, 'Workflow save lost the steps')
assert.equal(savedWorkflow.steps[0].command, 'test:rename', 'Workflow save lost the step command')
assert.equal(savedWorkflow.steps[0].phpCode, null, 'Workflow save kept PHP source for a non-script step')
console.log('Workflow row edit and save payload checked.')

deleteWarnings.length = 0
rowButton(render(), 'actions', 'command-center.ui.delete').props.onClick()
assert.equal(deleteWarnings.length, 1, 'Workflow delete ran without confirmation')
assert.equal(deleteWarnings[0].title, 'command-center.workflows.delete', 'Workflow delete confirmation lost its title')
assert.equal(deleteWarnings[0].content, 'command-center.workflows.delete-confirm', 'Workflow delete confirmation lost its message')
deleteWarnings[0].onOk(); await settle()
assert.equal(deletedWorkflow.id, 'workflow', 'Confirmed workflow delete sent the wrong id')
assert.equal(deletedWorkflow.revision, revision, 'Confirmed workflow delete dropped the revision')
workflowItems = () => []
render(false)
render()
await settle()
assert.equal(nodes(render()).some(node => node.props?.children === 'command-center.workflows.empty'), true, 'Empty workflow list showed no hint')
console.log('Workflow row delete, confirmed delete and empty state checked.')
