import { defineConfig } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
import { pluginModuleFederation } from '@module-federation/rsbuild-plugin'
import { pluginGenerateEntrypoints } from '@pimcore/studio-ui-bundle/rsbuild/plugins'
import { createDynamicRemote } from '@pimcore/studio-ui-bundle/rsbuild/utils'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'

const buildRoot = path.resolve(import.meta.dirname, '..', 'public', 'build')
if (fs.existsSync(buildRoot)) {
  for (const entry of fs.readdirSync(buildRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && /^[a-f0-9-]{36}$/.test(entry.name)) {
      fs.rmSync(path.join(buildRoot, entry.name), { recursive: true })
    }
  }
}
const buildId = randomUUID()
const assetPrefix = `/bundles/pimcorecommandcenter/build/${buildId}`

export default defineConfig({
  mode: 'production',
  source: { entry: { main: './js/src/main.ts' } },
  server: { port: 3035 },
  output: {
    manifest: true,
    assetPrefix,
    distPath: { root: path.resolve(import.meta.dirname, '..', 'public', 'build', buildId) }
  },
  tools: { bundlerChain: chain => { chain.output.uniqueName('watza_command_center_bundle') } },
  plugins: [
    pluginReact(),
    pluginGenerateEntrypoints(),
    pluginModuleFederation({
      name: 'watza_command_center_bundle',
      filename: 'static/js/remoteEntry.js',
      exposes: { '.': './js/src/plugins.ts' },
      dts: false,
      remotes: { '@pimcore/studio-ui-bundle': createDynamicRemote('pimcore_studio_ui_bundle') },
      shared: {
        react: { singleton: true, eager: true, requiredVersion: false },
        'react-dom': { singleton: true, eager: true, requiredVersion: false }
      }
    })
  ]
})
