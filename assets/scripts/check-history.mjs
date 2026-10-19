import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setImmediate } from 'node:timers/promises'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import ts from 'typescript'

const hooks = []
let cursor = 0, effects = []
const dispatcher = {
  useState(initial) {
    const index = cursor++
    if (!(index in hooks)) hooks[index] = initial
    return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value }]
  },
  useEffect(effect, dependencies) {
    const index = cursor++
    const old = hooks[index]
    if (old === undefined || dependencies.some((value, position) => !Object.is(value, old.dependencies[position]))) {
      effects.push(() => {
        old?.cleanup?.()
        hooks[index] = { dependencies, cleanup: effect() }
      })
    }
  }
}
const components = new Proxy({}, { get: (_, name) => name })
const exports = {}, requests = [], intervals = new Set()
let pending, rejectDetail = false
const source = readFileSync(new URL('../js/src/components/command-center/run-history.tsx', import.meta.url), 'utf8')
runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true }
}).outputText, {
  exports, AbortController, URLSearchParams,
  require: name => {
    if (name === 'react') return React
    if (name === '@tanstack/react-table') return { createColumnHelper }
    if (name === '@pimcore/studio-ui-bundle/components') return components
    if (name === '@pimcore/studio-ui-bundle/app') return { useTranslation: () => ({ t: key => key, i18n: { language: 'en' } }) }
    if (name === './workflow-run') return { WorkflowRunView: 'WorkflowRunView', statusColor: () => 'success' }
    if (name === './grid-cell') return { padCells: columns => columns }
    if (name === './output') return { Output: 'Output' }
    if (name === './api') return { commandCenterUrl: path => path }
    throw new Error(`Unexpected import: ${name}`)
  },
  window: { setInterval: callback => { intervals.add(callback); return callback }, clearInterval: callback => intervals.delete(callback) },
  fetch: async (path, options) => {
    requests.push({ path, signal: options.signal })
    if (path.startsWith('history?')) return { ok: true, json: async () => ({ items: [{ id: 'first' }], total: 1 }) }
    if (rejectDetail) return { ok: false, status: 404, text: async () => 'Run unavailable' }
    const run = { id: path.split('/')[1], command: 'about', startedAt: null, status: 'success', tokens: [], output: 'run output', parentRunId: 'parent' }
    return { ok: true, json: async () => pending ?? run }
  }
})
const render = (active = true) => {
  cursor = 0
  const internal = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher
  const previous = internal.current
  internal.current = dispatcher
  let tree
  try { tree = exports.RunHistory({ active }) } finally { internal.current = previous }
  const queued = effects; effects = []
  for (const effect of queued) effect()
  return tree
}
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes)
  : React.isValidElement(tree) ? [tree, ...nodes(tree.props.children), ...nodes(tree.props.footer)] : []
const modal = tree => nodes(tree).find(node => node.type === 'WindowModal')
const choose = (tree, id) => {
  const grid = nodes(tree).find(node => node.type === 'Grid')
  grid.props.columns.find(column => column.id === 'details').cell({ row: { original: { id } } }).props.onClick()
}
const settle = async () => { await setImmediate(); await setImmediate() }
render(); await settle()
assert.equal(modal(render()), undefined)
let resolvePending
pending = new Promise(resolve => { resolvePending = resolve })
choose(render(), 'first')
assert.equal(modal(render()).props.open, true, 'Details did not open immediately')
assert.equal(nodes(modal(render())).some(node => node.type === 'Content' && node.props.loading), true)
await settle()
modal(render()).props.onCancel(); render()
assert.equal(requests.find(request => request.path === 'history/first').signal.aborted, true)
pending = undefined
choose(render(), 'second'); render(); await settle()
resolvePending({ id: 'first', command: 'stale' }); await settle()
assert.equal(nodes(modal(render())).some(node => node.type === 'Output' && node.props.text === 'run output'), true)
assert.equal(nodes(modal(render())).some(node => node.props.children === 'second'), true, 'Late response replaced the selected run')
modal(render()).props.onCancel(); render()
choose(render(), 'second'); render(); await settle()
assert.equal(requests.filter(request => request.path === 'history/second').length, 2, 'Same run could not be reopened')
const parentButton = nodes(modal(render())).find(node => node.type === 'Button' && node.props.children === 'command-center.workflows.parent')
parentButton.props.onClick(); render(); await settle()
assert.equal(nodes(modal(render())).some(node => node.props.children === 'parent'), true)
modal(render()).props.onCancel(); render()
rejectDetail = true
choose(render(), 'missing'); render(); await settle()
assert.equal(nodes(modal(render())).some(node => node.type === 'Alert' && node.props.message.includes('404')), true, 'Detail error was invisible')
modal(render()).props.onCancel(); render()
assert.equal(modal(render()), undefined)
render(false)
assert.equal(intervals.size, 0, 'History polling survived tab deactivation')
console.log('History detail modal, loading, reopen, abort, stale responses, parent navigation and errors checked.')

// Der Navigations-Badge zaehlt nur laufende/queued Runs und stoppt mit dem Unmount.
const badgeIntervals = new Set()
let badgeItems = []
const badgeExports = {}
const badgeSource = readFileSync(new URL('../js/src/components/command-center/nav-title.tsx', import.meta.url), 'utf8')
runInNewContext(ts.transpileModule(badgeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true }
}).outputText, {
  exports: badgeExports,
  require: name => {
    if (name === 'react') return React
    if (name === '@pimcore/studio-ui-bundle/components') return components
    if (name === '@pimcore/studio-ui-bundle/app') return { useTranslation: () => ({ t: key => key }) }
    if (name === './api') return { commandCenterUrl: path => path }
    throw new Error(`Unexpected import: ${name}`)
  },
  AbortController,
  window: { setInterval: callback => { badgeIntervals.add(callback); return callback }, clearInterval: callback => badgeIntervals.delete(callback) },
  fetch: async path => ({ ok: true, json: async () => ({ items: badgeItems, total: badgeItems.length }) })
})
const renderBadge = () => {
  cursor = 0
  const internal = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher
  const previous = internal.current
  internal.current = dispatcher
  let tree
  try { tree = badgeExports.CommandCenterNavTitle() } finally { internal.current = previous }
  const queued = effects; effects = []
  for (const effect of queued) effect()
  return tree
}
hooks.length = 0
badgeItems = [{ status: 'running', active: true }, { status: 'running', active: true }, { status: 'running', active: false }]
renderBadge(); await settle()
let badgeTree = renderBadge()
assert.equal(nodes(badgeTree).some(node => node.type === 'Tag' && node.props.color === 'processing' && node.props.children === 2), true, 'Nav badge did not count active runs')
hooks.length = 0
badgeItems = []
renderBadge(); await settle()
badgeTree = renderBadge()
assert.equal(nodes(badgeTree).some(node => node.type === 'Tag'), false, 'Nav badge stayed visible without active runs')
console.log('Navigation badge counts active runs and hides when idle.')
