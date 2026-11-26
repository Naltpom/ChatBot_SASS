// Liste les textes passés à t('…') sans traduction anglaise dans src/i18n/en/*.ts (et les fichiers où ils sont).
// Usage : node scripts/i18n-check.mjs [fichiers…]   (sans argument : tout src/)
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../src/', import.meta.url).pathname
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|mjs)$/.test(f) ? [p] : [] })
const dictDir = join(root, 'i18n/en')
const keys = new Set()
const entry = /^\s*(['"`])((?:\\.|(?!\1).)*)\1\s*:/gm
for (const f of readdirSync(dictDir)) {
  const s = readFileSync(join(dictDir, f), 'utf8')
  for (const m of s.matchAll(entry)) keys.add(m[2].replace(/\\(['"`\\])/g, '$1'))
}
const files = process.argv.slice(2).length ? process.argv.slice(2) : walk(root).filter(p => !p.includes('/i18n/') && !p.endsWith('/i18n.ts'))
const call = /\bt\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g
let missing = 0
for (const f of files) {
  const s = readFileSync(f, 'utf8')
  for (const m of s.matchAll(call)) {
    if (m[1] === '`' && m[2].includes('${')) { console.log(`${f}: t() avec \${…} : utilisez {nom} et des valeurs → ${m[2].slice(0, 60)}`); missing++; continue }
    const k = m[2].replace(/\\(['"`\\])/g, '$1')
    if (!keys.has(k)) { console.log(`${f}: ${k}`); missing++ }
  }
}
console.log(missing ? `${missing} texte(s) sans traduction.` : 'Toutes les traductions sont là.')
process.exit(missing ? 1 : 0)
