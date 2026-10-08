import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

function fixture(fail: boolean) {
  const directory = mkdtempSync(path.join(tmpdir(), 'underwater-startup-test-'))
  const bin = path.join(directory, 'bin')
  const media = path.join(directory, 'media')
  mkdirSync(bin)
  mkdirSync(media)
  const database = path.join(directory, 'payload.db')
  for (const file of [database, database + '-wal', database + '-shm', path.join(media, 'proof.txt')]) {
    writeFileSync(file, 'preserve-this-fixture')
  }
  const commands = path.join(directory, 'commands.txt')
  writeFileSync(path.join(bin, 'pnpm'), [
    '#!/bin/sh',
    'printf "%s\\n" "$*" >> "$UW_TEST_LOG"',
    'if [ "$*" = "exec payload migrate" ] && [ "$UW_TEST_FAIL" = "1" ]; then exit 17; fi',
    'exit 0',
  ].join('\n'), { mode: 0o755 })
  const source = readFileSync(new URL('../scripts/start.sh', import.meta.url), 'utf8')
  const script = path.join(directory, 'start.sh')
  writeFileSync(script, source.replace('cd /app', 'cd "' + directory + '"'))
  const result = spawnSync('sh', [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: bin + path.delimiter + process.env.PATH,
      UW_TEST_LOG: commands,
      UW_TEST_FAIL: fail ? '1' : '0',
      DATABASE_URI: 'file:' + database,
      MEDIA_DIR: media,
    },
  })
  return { directory, result, database, media, commands }
}

test('migration failure preserves database, WAL, SHM and media, and never starts or seeds', t => {
  const f = fixture(true)
  t.after(() => rmSync(f.directory, { recursive: true }))
  assert.equal(f.result.status, 1)
  for (const file of [f.database, f.database + '-wal', f.database + '-shm', path.join(f.media, 'proof.txt')]) {
    assert.equal(readFileSync(file, 'utf8'), 'preserve-this-fixture')
  }
  assert.equal(readFileSync(f.commands, 'utf8'), 'exec payload migrate\n')
  assert.match(f.result.stderr, /preserved/)
})

test('successful migration starts the server without seeding', t => {
  const f = fixture(false)
  t.after(() => rmSync(f.directory, { recursive: true }))
  assert.equal(f.result.status, 0)
  assert.equal(readFileSync(f.commands, 'utf8'), 'exec payload migrate\nexec next start -p 3000\n')
})
