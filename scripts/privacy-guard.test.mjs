import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hashTerm, normalize, parseDenylist, scanFiles } from './privacy-guard.mjs'

const denylist = parseDenylist(`# comment\n\n${hashTerm('termo proibido exemplo')}\n`)

function withRepo(files, fn) {
  const root = mkdtempSync(join(tmpdir(), 'privacy-guard-'))
  try {
    for (const [path, content] of Object.entries(files)) {
      const full = join(root, path)
      mkdirSync(join(full, '..'), { recursive: true })
      writeFileSync(full, content)
    }
    return fn(root, Object.keys(files))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('normalize lowercases, strips accents and punctuation', () => {
  assert.equal(normalize('  Ação,  JOÃO-da_Silva! '), 'acao joao da silva')
})

test('flags a denied term with path and line', () => {
  withRepo({ 'docs/a.md': 'ok\nhere: termo proibido exemplo!\n' }, (root, files) => {
    assert.deepEqual(scanFiles({ root, files, denylist }), [{ path: 'docs/a.md', line: 2 }])
  })
})

test('catches accented and uppercase variants', () => {
  withRepo({ 'a.txt': 'TÉRMO Proibído, EXEMPLO' }, (root, files) => {
    assert.equal(scanFiles({ root, files, denylist }).length, 1)
  })
})

test('clean file passes', () => {
  withRepo({ 'a.txt': 'termo exemplo proibido\nnothing here' }, (root, files) => {
    assert.deepEqual(scanFiles({ root, files, denylist }), [])
  })
})

test('single words and pairs inside a longer line are matched', () => {
  const single = parseDenylist(hashTerm('zebra'))
  withRepo({ 'a.txt': 'a big Zebra runs' }, (root, files) => {
    assert.equal(scanFiles({ root, files, denylist: single }).length, 1)
  })
})

test('binary files, ignored folders and lockfiles are skipped', () => {
  const text = 'termo proibido exemplo'
  withRepo(
    {
      'bin.dat': `\0${text}`,
      'img.png': text,
      'privacy/denylist.sha256': text,
      'node_modules/x/index.js': text,
      'frontend/package-lock.json': text,
    },
    (root, files) => {
      assert.deepEqual(scanFiles({ root, files, denylist }), [])
    },
  )
})
