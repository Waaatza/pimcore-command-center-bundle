import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const root = path.resolve(import.meta.dirname, '../..')
const read = language => {
  const entries = new Map()
  for (const line of fs.readFileSync(`${root}/translations/studio.${language}.yaml`, 'utf8').split('\n')) {
    if (line.trim() === '' || line.startsWith('#')) continue
    const separator = line.indexOf(':')
    if (separator < 0) throw new Error(`Invalid translation line: ${line}`)
    const key = line.slice(0, separator)
    const raw = line.slice(separator + 1).trim()
    if (entries.has(key)) throw new Error(`Duplicate ${language} key: ${key}`)
    const value = raw.startsWith('"') ? JSON.parse(raw) : raw
    if (value === '') throw new Error(`Empty ${language} translation: ${key}`)
    entries.set(key, value)
  }
  return entries
}
const de = read('de')
const en = read('en')
for (const key of new Set([...de.keys(), ...en.keys()])) {
  if (!de.has(key) || !en.has(key)) throw new Error(`Missing translation: ${key}`)
  const placeholders = value => [...value.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(match => match[1]).sort().join(',')
  if (placeholders(de.get(key)) !== placeholders(en.get(key))) throw new Error(`Placeholder mismatch: ${key}`)
}
let count = 0
const visitFile = filename => {
  const ast = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 't' && ts.isStringLiteral(node.arguments[0])) {
      const key = node.arguments[0].text
      if (!en.has(key)) throw new Error(`Missing UI translation: ${key} in ${filename}`)
      count++
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
}
for (const filename of fs.readdirSync(`${root}/assets/js/src/components/command-center`)) {
  if (filename.endsWith('.tsx')) visitFile(`${root}/assets/js/src/components/command-center/${filename}`)
}
for (const status of ['ready', 'running-progress', 'exit', 'interrupted']) {
  if (!en.has(`command-center.status.${status}`)) throw new Error(`Missing execution status: ${status}`)
}
console.log(`English/German translation parity, interpolation and ${count} UI references checked.`)
