import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setImmediate } from 'node:timers/promises'
import { runInNewContext } from 'node:vm'
import React from 'react'
import ts from 'typescript'

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
  Form: { useForm: () => [{}], useWatch: () => undefined, Item: 'Form.Item' }
}, { get: (target, name) => target[name] ?? name })
let revision = 1
let pendingPreview
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
    if (name === './api') return { commandCenterUrl: path => path }
    if (name === './input-fields') return { InputFieldEditor: 'InputFieldEditor' }
    if (name === './output') return { Output: 'Output' }
    throw new Error(`Unexpected import: ${name}`)
  },
  AbortController,
  fetch: async path => ({
    ok: true,
    json: async () => {
      if (path === 'templates') return { items: [{
        id: 'template', revision, label: 'Rename', command: 'test:rename',
        description: '', tokens: [], fields: [], previewSupported: true
      }] }
      if (path === 'list') return { commands: [{ name: 'test:rename' }], csrfToken: 'token' }
      if (path === 'templates/preview') return pendingPreview ?? { supported: true, count: 1, samples: [] }
      throw new Error(`Unexpected request: ${path}`)
    }
  })
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
  return [tree, ...nodes(tree.props.children)]
}
const button = (tree, key) => nodes(tree).find(node => node.type === 'Button' && node.props.children === key)
const settle = async () => { await setImmediate(); await setImmediate() }
const checkBlocked = tree => {
  assert.equal(button(tree, 'command-center.ui.execute').props.disabled, true)
  assert.equal(nodes(tree).some(node => node.props.children === 'command-center.templates.preview-count'), false)
}

render()
await settle()
nodes(render()).find(node => node.type === 'Select').props.onChange('template')
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
