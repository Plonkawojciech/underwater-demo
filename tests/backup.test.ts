import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../scripts/backup/underwater_backup.py', import.meta.url))
const RUNTIME = '/Users/wojciechplonka/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3'
const PYTHON = process.env.UNDERWATER_BACKUP_PYTHON || (existsSync(RUNTIME) ? RUNTIME : 'python3')
const ENV = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }
const probe = spawnSync(PYTHON, ['-c', 'import cryptography.hazmat.primitives.ciphers'], { env: ENV })
const skip = probe.status === 0 ? false : 'Python with the cryptography package is not available'

const KEY = randomBytes(32)
const keyInput = (key: Buffer = KEY) => JSON.stringify({ key: key.toString('base64') })

function run(args: string[], key: Buffer = KEY) {
  const result = spawnSync(PYTHON, [SCRIPT, ...args, '--min-free-bytes', '0'], { input: keyInput(key), encoding: 'utf8', env: ENV })
  return { ...result, report: result.status === 0 ? JSON.parse(result.stdout) : null }
}

function workspace(t: test.TestContext) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'underwater-backup-test-')))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** A synthetic isolated data root: WAL database, nested binary media, and an .env next to them. */
function dataRoot(dir: string) {
  const root = path.join(dir, 'root')
  mkdirSync(path.join(root, 'media', 'products'), { recursive: true })
  const media = {
    'media/hero.webp': randomBytes(300_000),
    'media/products/maska-zażółć.jpg': randomBytes(4097),
    'media/products/empty.txt': Buffer.alloc(0),
  }
  for (const [name, bytes] of Object.entries(media)) writeFileSync(path.join(root, name), bytes)
  writeFileSync(path.join(root, '.env'), 'PAYLOAD_SECRET=synthetic-never-archive-this-secret\n')
  const db = new DatabaseSync(path.join(root, 'underwater-test.db'))
  db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT);")
  return { root, media, db }
}

function files(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(path.join(dir, entry.name), prefix + entry.name + '/') : [prefix + entry.name]).sort()
}

function archiveIn(dir: string) {
  const [name] = readdirSync(dir)
  return path.join(dir, name)
}

test('backup of a live WAL database restores into a fresh clone with exact media bytes', { skip }, t => {
  const dir = workspace(t)
  const { root, media, db } = dataRoot(dir)
  const insert = db.prepare('INSERT INTO products (name) VALUES (?)')
  for (let i = 0; i < 500; i++) insert.run('produkt-' + i)
  // The rows live only in the WAL while the connection stays open.
  assert.ok(statSync(path.join(root, 'underwater-test.db-wal')).size > 0)

  const out = path.join(dir, 'backups', 'first')
  mkdirSync(path.dirname(out))
  const made = run(['backup', '--data-root', root, '--environment', 'test', '--destination', out])
  assert.equal(made.status, 0, made.stderr)
  assert.deepEqual(made.report.database, { integrity: 'ok', bytes: made.report.database.bytes, tables: 1, rows: 500, latest_migration: null })
  assert.deepEqual(made.report.media, { files: 3, bytes: 300_000 + 4097 })
  const archive = archiveIn(out)
  assert.equal(readdirSync(out).length, 1)
  assert.equal(statSync(out).mode & 0o777, 0o700)
  assert.equal(statSync(archive).mode & 0o777, 0o600)
  const sealed = readFileSync(archive)
  assert.equal(sealed.indexOf('produkt-499'), -1)
  assert.equal(sealed.indexOf('synthetic-never-archive-this-secret'), -1)

  db.prepare('INSERT INTO products (name) VALUES (?)').run('after-backup')
  db.close()

  const clone = path.join(dir, 'clone')
  const restored = run(['restore', '--archive', archive, '--destination', clone])
  assert.equal(restored.status, 0, restored.stderr)
  assert.equal(restored.report.database.integrity, 'ok')
  assert.equal(restored.report.database.rows, 500)
  assert.equal(restored.report.database.source_journal_mode, 'wal')
  assert.equal(restored.report.verified_files, 4)
  assert.deepEqual(files(clone), ['media/hero.webp', 'media/products/empty.txt', 'media/products/maska-zażółć.jpg', 'underwater-test.db'])
  for (const [name, bytes] of Object.entries(media)) {
    assert.ok(readFileSync(path.join(clone, name)).equals(bytes), name)
    assert.equal(statSync(path.join(clone, name)).mode & 0o777, 0o600)
  }
  assert.equal(statSync(path.join(clone, 'media/products')).mode & 0o777, 0o700)
  const copy = new DatabaseSync(path.join(clone, 'underwater-test.db'), { readOnly: true })
  t.after(() => copy.close())
  assert.deepEqual({ ...copy.prepare('SELECT count(*) AS n, max(name) AS last FROM products').get() }, { n: 500, last: 'produkt-99' })
  // No staging or spool leftovers next to the clone; the archive is preserved.
  assert.deepEqual(readdirSync(dir).sort(), ['backups', 'clone', 'root'])
  assert.ok(readFileSync(archive).equals(sealed))

  // A second backup goes to its own new directory and leaves the older one intact.
  const second = path.join(dir, 'backups', 'second')
  assert.equal(run(['backup', '--data-root', root, '--environment', 'test', '--destination', second]).status, 0)
  assert.ok(readFileSync(archive).equals(sealed))
})

test('tampered ciphertext, tampered header or a wrong key produce no destination', { skip }, t => {
  const dir = workspace(t)
  const { root, db } = dataRoot(dir)
  db.prepare('INSERT INTO products (name) VALUES (?)').run('synthetic')
  db.close()
  const out = path.join(dir, 'out')
  assert.equal(run(['backup', '--data-root', root, '--environment', 'test', '--destination', out]).status, 0)
  const original = readFileSync(archiveIn(out))

  const flipped = Buffer.from(original)
  flipped[Math.floor(flipped.length / 2)] ^= 0x01
  // Same-length edit of the plaintext header: it parses fine, so only GCM associated data can catch it.
  const relabelled = Buffer.from(original.toString('latin1').replace('"created_at":"2', '"created_at":"3'), 'latin1')
  assert.equal(relabelled.length, original.length)
  assert.notEqual(relabelled.indexOf('"created_at":"3'), -1)
  const cases: Array<[string, Buffer, Buffer]> = [
    ['ciphertext', flipped, KEY],
    ['header', relabelled, KEY],
    ['truncated', original.subarray(0, original.length - 7), KEY],
    ['wrong-key', original, randomBytes(32)],
  ]
  for (const [label, bytes, key] of cases) {
    const archive = path.join(dir, label + '.uwbak')
    writeFileSync(archive, bytes)
    const destination = path.join(dir, 'clone-' + label)
    const result = run(['restore', '--archive', archive, '--destination', destination], key)
    assert.notEqual(result.status, 0, label)
    assert.match(result.stderr, /refused: authentication failed/, label)
    assert.equal(existsSync(destination), false, label)
    assert.ok(readFileSync(archive).equals(bytes), label)
  }
  assert.deepEqual(readdirSync(dir).filter(name => name.startsWith('.')), [])
})

const UNSAFE = String.raw`
import importlib.util, io, json, os, sys, tarfile, hashlib, base64
spec = importlib.util.spec_from_file_location("uwbak", sys.argv[1])
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
key = base64.b64decode(json.loads(sys.stdin.read())["key"])
out = sys.argv[2]
db = open(sys.argv[3], "rb").read()
HEADER = {"format": "underwater-backup", "format_version": 1, "tool_version": "test", "environment": "test", "created_at": "2026-10-08T00:00:00Z"}

def regular(name, data):
    info = tarfile.TarInfo(name); info.size = len(data); return info, io.BytesIO(data)

def special(name, kind, link=""):
    info = tarfile.TarInfo(name); info.type = kind; info.linkname = link; return info, None

def entry(name, data):
    return {"path": name, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}

def seal(label, members, media, database=None):
    database = database or entry("underwater-test.db", db)
    manifest = json.dumps(dict(HEADER, database=database, media=media)).encode()
    with open(os.path.join(out, label + ".uwbak"), "wb") as handle:
        writer = module.SealedWriter(handle, key, HEADER)
        with tarfile.open(fileobj=writer, mode="w|", format=tarfile.PAX_FORMAT) as tar:
            tar.addfile(*regular("underwater-test.db", db))
            for info, data in members:
                tar.addfile(info, data)
            tar.addfile(*regular("MANIFEST.json", manifest))
        writer.finish()

payload = b"synthetic"
seal("symlink", [special("media/link.jpg", tarfile.SYMTYPE, "/etc/passwd")], [])
seal("hardlink", [special("media/link.jpg", tarfile.LNKTYPE, "underwater-test.db")], [])
seal("directory", [special("media/folder", tarfile.DIRTYPE)], [])
seal("fifo", [special("media/pipe", tarfile.FIFOTYPE)], [])
seal("traversal", [regular("media/../../escape.txt", payload)], [entry("media/../../escape.txt", payload)])
seal("absolute", [regular("/tmp/underwater-escape.txt", payload)], [entry("/tmp/underwater-escape.txt", payload)])
seal("outside", [regular(".env", payload)], [entry(".env", payload)])
seal("duplicate", [regular("media/a.jpg", payload), regular("media/A.jpg", payload)], [entry("media/a.jpg", payload), entry("media/A.jpg", payload)])
seal("unlisted", [regular("media/extra.jpg", payload)], [])
seal("missing", [], [entry("media/listed.jpg", payload)])
seal("checksum", [regular("media/a.jpg", payload)], [dict(entry("media/a.jpg", payload), sha256="0" * 64)])
seal("control", [regular("media/ok.jpg", payload)], [entry("media/ok.jpg", payload)])
seal("quota", [regular("media/big.bin", b"x" * 300000)], [entry("media/big.bin", b"x" * 300000)])
`

test('authenticated but unsafe tar members are rejected before anything reaches the destination', { skip }, t => {
  const dir = workspace(t)
  const database = path.join(dir, 'valid.db')
  const db = new DatabaseSync(database)
  db.exec('CREATE TABLE t (x); INSERT INTO t VALUES (1);')
  db.close()
  const archives = path.join(dir, 'archives')
  mkdirSync(archives)
  const built = spawnSync(PYTHON, ['-c', UNSAFE, SCRIPT, archives, database], { input: keyInput(), encoding: 'utf8', env: ENV })
  assert.equal(built.status, 0, built.stderr)

  const expected: Record<string, RegExp> = {
    symlink: /regular files/, hardlink: /regular files/, directory: /regular files/, fifo: /regular files/,
    traversal: /unsafe name/, absolute: /absolute/, outside: /outside the database/, duplicate: /duplicate/,
    unlisted: /do not match the manifest/, missing: /do not match the manifest/, checksum: /checksum/,
    quota: /per-file quota/,
  }
  for (const [label, message] of Object.entries(expected)) {
    const destination = path.join(dir, 'clone-' + label)
    const result = run(['restore', '--archive', path.join(archives, label + '.uwbak'), '--destination', destination, '--max-file-bytes', '200000'])
    assert.equal(result.status, 2, label + ': ' + result.stderr)
    assert.match(result.stderr, message, label)
    assert.equal(existsSync(destination), false, label)
  }
  // The well-formed control archive from the same builder restores, so rejections are about the members.
  const control = run(['restore', '--archive', path.join(archives, 'control.uwbak'), '--destination', path.join(dir, 'control')])
  assert.equal(control.status, 0, control.stderr)
  assert.equal(control.report.database.rows, 1)
  assert.equal(existsSync('/tmp/underwater-escape.txt'), false)
  assert.equal(existsSync(path.join(dir, 'escape.txt')), false)
  assert.deepEqual(readdirSync(dir).sort(), ['archives', 'control', 'valid.db'])
})

test('restore and backup never write into a destination that already has content', { skip }, t => {
  const dir = workspace(t)
  const { root, db } = dataRoot(dir)
  db.close()
  const out = path.join(dir, 'out')
  assert.equal(run(['backup', '--data-root', root, '--environment', 'test', '--destination', out]).status, 0)
  const archive = archiveIn(out)

  const occupied = path.join(dir, 'occupied')
  mkdirSync(occupied)
  writeFileSync(path.join(occupied, 'underwater-test.db'), 'existing-application-database')
  const restore = run(['restore', '--archive', archive, '--destination', occupied])
  assert.equal(restore.status, 2)
  assert.deepEqual(readdirSync(occupied), ['underwater-test.db'])
  assert.equal(readFileSync(path.join(occupied, 'underwater-test.db'), 'utf8'), 'existing-application-database')

  const again = run(['backup', '--data-root', root, '--environment', 'test', '--destination', out])
  assert.equal(again.status, 2)
  assert.deepEqual(readdirSync(out), [path.basename(archive)])

  for (const destination of [path.join(root, 'backups'), path.join(root, 'media', 'backups')]) {
    assert.equal(run(['backup', '--data-root', root, '--environment', 'test', '--destination', destination]).status, 2)
    assert.equal(existsSync(destination), false)
  }

  // An empty pre-created destination is acceptable and becomes the clone.
  const empty = path.join(dir, 'empty')
  mkdirSync(empty)
  assert.equal(run(['restore', '--archive', archive, '--destination', empty]).status, 0)
  assert.ok(existsSync(path.join(empty, 'underwater-test.db')))
})

test('symlinked or secret media, unsafe paths and a missing disk reserve fail closed', { skip }, t => {
  const dir = workspace(t)
  const { root, db } = dataRoot(dir)
  db.close()
  const refused = (args: string[], label: string, message: RegExp) => {
    const destination = path.join(dir, 'out-' + label)
    const result = spawnSync(PYTHON, [SCRIPT, 'backup', '--data-root', root, '--environment', 'test', '--destination', destination, ...args],
      { input: keyInput(), encoding: 'utf8', env: ENV })
    assert.equal(result.status, 2, label + ': ' + result.stderr)
    assert.match(result.stderr, message, label)
    assert.equal(existsSync(destination), false, label)
  }

  refused(['--min-free-bytes', String(2 ** 60)], 'reserve', /free disk space/)

  const outside = path.join(dir, 'outside-secret.txt')
  writeFileSync(outside, 'never follow this link')
  symlinkSync(outside, path.join(root, 'media', 'products', 'linked.jpg'))
  refused(['--min-free-bytes', '0'], 'symlink', /symlink/)
  rmSync(path.join(root, 'media', 'products', 'linked.jpg'))

  writeFileSync(path.join(root, 'media', '.env.local'), 'SECRET=synthetic')
  refused(['--min-free-bytes', '0'], 'env', /environment file/)
  rmSync(path.join(root, 'media', '.env.local'))

  const linkedRoot = path.join(dir, 'linked-root')
  symlinkSync(root, linkedRoot)
  for (const [label, dataRootArg] of [['relative', 'root'], ['traversal', root + '/../root'], ['linked', linkedRoot]]) {
    const result = run(['backup', '--data-root', dataRootArg, '--environment', 'test', '--destination', path.join(dir, 'out-' + label)])
    assert.equal(result.status, 2, label)
    assert.equal(existsSync(path.join(dir, 'out-' + label)), false, label)
  }
  for (const key of ['{"key":"c2hvcnQ="}', '{}', 'not-json']) {
    const result = spawnSync(PYTHON, [SCRIPT, 'backup', '--data-root', root, '--environment', 'test', '--destination', path.join(dir, 'out-key'), '--min-free-bytes', '0'],
      { input: key, encoding: 'utf8', env: ENV })
    assert.equal(result.status, 2)
    assert.equal(existsSync(path.join(dir, 'out-key')), false)
  }
  assert.equal(run(['backup', '--data-root', root, '--environment', 'preview', '--destination', path.join(dir, 'out-env')]).status, 2)

  // After removing the unsafe entries the same root backs up, and .env never enters the archive.
  const ok = run(['backup', '--data-root', root, '--environment', 'test', '--destination', path.join(dir, 'out-ok')])
  assert.equal(ok.status, 0, ok.stderr)
  const clone = path.join(dir, 'clone')
  assert.equal(run(['restore', '--archive', archiveIn(path.join(dir, 'out-ok')), '--destination', clone]).status, 0)
  assert.equal(files(clone).some(name => name.includes('.env')), false)
  assert.equal(lstatSync(path.join(root, '.env')).isFile(), true)
})
