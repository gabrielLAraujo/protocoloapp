// Privacy guard: fails when a tracked text file contains a denylisted term.
// The denylist (privacy/denylist.sha256) only holds sha256 hashes of normalized terms (1 to 3 words).
// Output never includes the term or its hash, only path:line.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.ttf', '.jar', '.keystore', '.apk',
])
const LOCKFILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock', 'packages.lock.json', 'gradle.lockfile',
])
const MAX_NGRAM = 3

export function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function hashTerm(text) {
  return createHash('sha256').update(normalize(text)).digest('hex')
}

export function parseDenylist(content) {
  const hashes = new Set()
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim().toLowerCase()
    if (line && !line.startsWith('#')) hashes.add(line)
  }
  return hashes
}

export function lineHasDeniedTerm(line, denylist) {
  const words = normalize(line).split(' ').filter(Boolean)
  for (let i = 0; i < words.length; i++) {
    let term = ''
    for (let n = 1; n <= MAX_NGRAM && i + n <= words.length; n++) {
      term = n === 1 ? words[i] : `${term} ${words[i + n - 1]}`
      if (denylist.has(createHash('sha256').update(term).digest('hex'))) return true
    }
  }
  return false
}

export function shouldSkip(path) {
  const parts = path.split('/')
  if (parts[0] === 'privacy') return true
  if (parts.includes('node_modules')) return true
  if (LOCKFILES.has(parts[parts.length - 1])) return true
  const ext = extname(path).toLowerCase()
  return BINARY_EXTENSIONS.has(ext) || ext.startsWith('.woff')
}

function isBinary(buffer) {
  return buffer.subarray(0, 8192).includes(0)
}

/** Returns [{ path, line }] for every line containing a denylisted term. */
export function scanFiles({ root, files, denylist }) {
  const hits = []
  for (const path of files) {
    if (shouldSkip(path)) continue
    let buffer
    try {
      buffer = readFileSync(join(root, path))
    } catch {
      continue
    }
    if (isBinary(buffer)) continue
    const lines = buffer.toString('utf8').split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] && lineHasDeniedTerm(lines[i], denylist)) hits.push({ path, line: i + 1 })
    }
  }
  return hits
}

function main() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  const denylistPath = join(root, 'privacy', 'denylist.sha256')
  if (!existsSync(denylistPath)) {
    console.error('privacy-guard: privacy/denylist.sha256 not found')
    process.exit(2)
  }
  const denylist = parseDenylist(readFileSync(denylistPath, 'utf8'))
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean)
  const hits = scanFiles({ root, files, denylist })
  if (hits.length > 0) {
    for (const hit of hits) console.error(`${hit.path}:${hit.line}: termo proibido`)
    console.error(`privacy-guard: ${hits.length} ocorrencia(s)`)
    process.exit(1)
  }
  console.log(`privacy-guard: OK (${files.length} arquivos, ${denylist.size} termos)`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
