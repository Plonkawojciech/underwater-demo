import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Synthetic only: a fake in-process FTP server, a throwaway key and password.
// No network, no real credentials, no private captures.
const CODEX_PYTHON = '/Users/wojciechplonka/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3'
const PYTHON = process.env.SNAPSHOT_TEST_PYTHON || (existsSync(CODEX_PYTHON) ? CODEX_PYTHON : 'python3')
const MANIFEST_AAD = Buffer.from('underwater-source-manifest')
const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }

const HARNESS = String.raw`
import base64, collections, fcntl, ftplib, hashlib, json, os, signal, ssl, sys, threading, time
sys.path.insert(0, 'scripts/source')
import snapshot_worker as w

config = json.load(open(sys.argv[1]))
files = {path: dict(spec, data=base64.b64decode(spec['data'])) for path, spec in config['files'].items()}
lock = threading.Lock()
stats = {'connects': 0, 'open': 0, 'max_open': 0, 'active': 0, 'max_active': 0, 'retr': collections.Counter(),
         'retr_total': 0, 'shared_connections': 0, 'interrupts': 0, 'closes': 0, 'connect_failures': 0}
connections = []

class FakeFTP:
    def __init__(self):
        self.owners = set(); self.closed = False; self.cut = threading.Event(); self.mdtm_calls = 0
    def use(self):
        self.owners.add(threading.get_ident())
        if self.closed: raise OSError('closed connection')
    def spec(self, remote):
        spec = files.get(remote[1:])
        if spec is None: raise ftplib.error_perm('550 No such file')
        return spec
    def size(self, remote):
        self.use(); return len(self.spec(remote)['data'])
    def sendcmd(self, line):
        self.use(); verb, remote = line.split(' ', 1); spec = self.spec(remote)
        if spec.get('changing'):
            self.mdtm_calls += 1; return '213 202610081200%02d' % self.mdtm_calls
        return '213 20261008120000'
    def retrbinary(self, command, callback, blocksize=8192):
        self.use(); path = command.split(' ', 1)[1][1:]; spec = self.spec('/' + path)
        with lock:
            stats['active'] += 1; stats['max_active'] = max(stats['max_active'], stats['active'])
            stats['retr'][path] += 1; stats['retr_total'] += 1; attempt = stats['retr'][path]; total = stats['retr_total']
        try:
            if config.get('kill_after') == total: os.kill(os.getpid(), signal.SIGTERM)
            if spec.get('hang'):
                # Ignores the stop flag like a blocked socket read; only a socket cut frees it.
                if not self.cut.wait(30): raise AssertionError('hung transfer was never interrupted')
                raise ConnectionResetError('socket shut down')
            failures = spec.get('fail', 0)
            if failures < 0 or attempt <= failures:
                kind = spec.get('fail_kind', 'temp')
                if kind == 'perm': raise ftplib.error_perm('550 Permission denied')
                if kind == 'reset': raise ConnectionResetError('reset')
                raise ftplib.error_temp('451 Transfer aborted')
            deadline = time.monotonic() + spec.get('delay', 0)
            data = spec['data']; step = max(1, min(blocksize, 7))
            for offset in range(0, len(data), step):
                callback(data[offset:offset + step])
            if not data: callback(b'')
            while time.monotonic() < deadline: time.sleep(0.002)
        finally:
            with lock: stats['active'] -= 1
    def interrupt(self):
        with lock: stats['interrupts'] += 1
        self.cut.set()
    def quit(self):
        self.close()
    def close(self):
        with lock:
            if not self.closed: stats['open'] -= 1; stats['closes'] += 1
        self.closed = True

def fake_connect(password):
    with lock:
        stats['connects'] += 1
        failure = config.get('connect_error')
        if failure == 'temp' and stats['connect_failures'] < config.get('connect_temp_failures', 0):
            stats['connect_failures'] += 1; raise ftplib.error_temp('421 Too many connections')
        if failure == 'cert': raise ssl.SSLCertVerificationError('certificate verify failed for ' + password)
        if hashlib.sha256(password.encode()).hexdigest() != config['password_sha256']:
            raise ftplib.error_perm('530 Login incorrect: ' + password)
        connection = FakeFTP(); connections.append(connection)
        stats['open'] += 1; stats['max_open'] = max(stats['max_open'], stats['open'])
        return connection

w.DEST = config['dest']; w.connect = fake_connect
w.SHUTDOWN_GRACE = config.get('grace', 2.0); w.RETRY_DELAY = 0.01; w.CONNECT_DELAY = 0.01
if 'free_bytes' in config: w.free_bytes = lambda path: config['free_bytes']
holder = None
if config.get('hold_lock'):
    os.makedirs(config['dest'], exist_ok=True)
    holder = os.open(os.path.join(config['dest'], 'snapshot.lock'), os.O_WRONLY | os.O_CREAT, 0o600); fcntl.flock(holder, fcntl.LOCK_EX)
started = time.monotonic()
try: code = w.cli(config.get('argv', []))
except SystemExit as error: code = error.code
stats['elapsed'] = time.monotonic() - started
stats['shared_connections'] = sum(1 for c in connections if len(c.owners) > 1)
stats['threads_alive'] = sum(1 for t in threading.enumerate() if t.name.startswith('uw-ftp'))
stats['retr'] = dict(stats['retr'])
print(json.dumps({'harness': stats}), flush=True)
sys.exit(code)
`

type Spec = { data: string | Buffer; fail?: number; fail_kind?: 'temp' | 'perm' | 'reset'; changing?: boolean; hang?: boolean; delay?: number }
type Row = { path: string; size: number; type?: string }
type Inventory = { files: Row[]; skipped?: Array<Record<string, string>>; complete_inventory?: boolean }
type Run = { status: number | null; lines: any[]; stats: any; summary: any; output: string }

function workspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'uw-snapshot-test-'))
  const dest = path.join(root, 'dest')
  const key = randomBytes(32)
  const password = 'synthetic-' + randomBytes(9).toString('hex')
  return { root, dest, key, password, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}
type Space = ReturnType<typeof workspace>

function seal(key: Buffer, data: unknown) {
  // Inventory in the same envelope the private inventory step writes (UWENC1).
  const result = spawnSync(PYTHON, ['-c', "import base64,json,sys; sys.path.insert(0,'scripts/source'); import snapshot_worker as w; r=json.load(sys.stdin); sys.stdout.write(base64.b64encode(w.seal_json(base64.b64decode(r['key']), r['data'])).decode())"],
    { input: JSON.stringify({ key: key.toString('base64'), data }), encoding: 'utf8', env })
  assert.equal(result.status, 0, result.stderr)
  return Buffer.from(result.stdout, 'base64')
}

function writeInventory(space: Space, inventory: Inventory) {
  mkdirSync(space.dest, { recursive: true, mode: 0o700 })
  writeFileSync(path.join(space.dest, 'inventory.enc'), seal(space.key, { complete_inventory: true, skipped: [], ...inventory }))
}

function run(space: Space, files: Record<string, Spec>, options: Record<string, unknown> = {}, credentials?: string): Run {
  const config = {
    dest: space.dest,
    // Synthetic transfers must not depend on the host's available disk space.
    // Explicit low-space cases below still exercise the production reserve.
    free_bytes: 100 * 1024 ** 3,
    password_sha256: createHash('sha256').update(space.password).digest('hex'),
    files: Object.fromEntries(Object.entries(files).map(([p, spec]) => [p, { ...spec, data: Buffer.from(spec.data).toString('base64') }])),
    ...options,
  }
  const configPath = path.join(space.root, 'config.json')
  writeFileSync(configPath, JSON.stringify(config))
  const input = credentials ?? JSON.stringify({ key: space.key.toString('base64'), password: Buffer.from(space.password).toString('base64') }) + '\n'
  const result = spawnSync(PYTHON, ['-c', HARNESS, configPath], { input, encoding: 'utf8', env, timeout: 60_000 })
  const lines = result.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line))
  const stats = lines.find(line => line.harness)?.harness
  assert.ok(stats, 'harness did not finish: ' + result.stderr)
  const summary = lines.find(line => 'finished' in line || 'error_type' in line)
  return { status: result.status, lines, stats, summary, output: result.stdout + result.stderr }
}

function manifest(space: Space) {
  const blob = readFileSync(path.join(space.dest, 'download-manifest.enc'))
  assert.equal(blob.subarray(0, 6).toString(), 'UWENC1')
  const decipher = createDecipheriv('aes-256-gcm', space.key, blob.subarray(6, 18))
  decipher.setAAD(MANIFEST_AAD); decipher.setAuthTag(blob.subarray(blob.length - 16))
  return JSON.parse(Buffer.concat([decipher.update(blob.subarray(18, blob.length - 16)), decipher.final()]).toString('utf8'))
}

const objectName = (p: string) => createHash('sha256').update(p).digest('hex') + '.enc'
const objectsDir = (space: Space) => path.join(space.dest, 'objects')

// Independent of the worker: AES-256-GCM, per-file nonce, the source path as AAD.
function openObject(space: Space, sourcePath: string, file = objectName(sourcePath)) {
  const blob = readFileSync(path.join(objectsDir(space), file))
  assert.equal(blob.subarray(0, 6).toString(), 'UWENC2')
  const decipher = createDecipheriv('aes-256-gcm', space.key, blob.subarray(6, 18))
  decipher.setAAD(Buffer.from(sourcePath)); decipher.setAuthTag(blob.subarray(blob.length - 16))
  return { plain: Buffer.concat([decipher.update(blob.subarray(18, blob.length - 16)), decipher.final()]), nonce: blob.subarray(6, 18).toString('hex') }
}

function synthetic(count: number, extra: Partial<Spec> = {}) {
  const files: Record<string, Spec> = {}
  for (let i = 0; i < count; i++) files[`public_html/images/f${String(i).padStart(4, '0')}.php`] = { data: `<?php echo "SYNTHETIC-PLAINTEXT-${i}"; ?>`, ...extra }
  return files
}
const rows = (files: Record<string, Spec>): Row[] => Object.entries(files).map(([p, spec]) => ({ path: p, size: Buffer.from(spec.data).length, type: 'file' }))
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')

function assertNoParts(space: Space) {
  assert.deepEqual(readdirSync(objectsDir(space)).filter(name => name.endsWith('.part')), [])
  assert.deepEqual(readdirSync(space.dest).filter(name => name.endsWith('.part')), [])
}

test('four independent connections, never more in flight than the bounded window', () => {
  const space = workspace()
  try {
    const files = synthetic(240, { delay: 0.004 })
    writeInventory(space, { files: rows(files) })
    const result = run(space, files)
    assert.equal(result.status, 0, result.output)
    assert.equal(result.stats.max_active, 4)
    assert.ok(result.stats.max_open <= 4)
    assert.equal(result.stats.connects, 4)
    assert.equal(result.stats.shared_connections, 0, 'a connection was used by more than one thread')
    assert.equal(result.stats.open, 0, 'connections left open')
    assert.equal(result.stats.threads_alive, 0)
    assert.ok(result.summary.max_in_flight <= 8)
    assert.equal(result.summary.complete_snapshot, true)
    assert.equal(result.summary.downloaded, 240)
    const progress = result.lines.filter(line => 'processed' in line && !('finished' in line))
    assert.ok(progress.length >= 3, 'expected progress about every 100 files')
    assert.ok(progress.every(line => !JSON.stringify(line).includes('public_html')))

    const report = manifest(space)
    assert.equal(report.database_snapshot, false)
    assert.equal(report.complete_snapshot, true)
    assert.equal(report.inventory_sha256, sha(readFileSync(path.join(space.dest, 'inventory.enc'))))
    assert.equal(report.files.length, 240)
    const nonces = new Set<string>()
    for (const record of report.files) {
      const { plain, nonce } = openObject(space, record.path, record.object)
      assert.equal(sha(plain), record.sha256)
      assert.equal(plain.toString(), files[record.path].data)
      nonces.add(nonce)
    }
    assert.equal(nonces.size, 240, 'nonces must be unique per file')
    for (const name of readdirSync(objectsDir(space))) {
      assert.equal(statSync(path.join(objectsDir(space), name)).mode & 0o777, 0o600)
      assert.ok(!readFileSync(path.join(objectsDir(space), name)).includes('SYNTHETIC-PLAINTEXT'), 'plaintext on disk')
    }
    assert.equal(statSync(path.join(space.dest, 'download-manifest.enc')).mode & 0o777, 0o600)
    assert.ok(!readFileSync(path.join(space.dest, 'download-manifest.enc')).includes('public_html'))
  } finally { space.cleanup() }
})

test('connection count is configurable and is the concurrency ceiling', () => {
  for (const connections of [1, 2]) {
    const space = workspace()
    try {
      const files = synthetic(24, { delay: 0.01 })
      writeInventory(space, { files: rows(files) })
      const result = run(space, files, { argv: ['--connections', String(connections)] })
      assert.equal(result.status, 0, result.output)
      assert.equal(result.stats.max_active, connections)
      assert.equal(result.stats.connects, connections)
      assert.ok(result.summary.max_in_flight <= 2 * connections)
      assert.equal(manifest(space).connections, connections)
    } finally { space.cleanup() }
  }
  const space = workspace()
  try {
    const files = synthetic(1)
    writeInventory(space, { files: rows(files) })
    const rejected = run(space, files, { argv: ['--connections', '5'] })
    assert.equal(rejected.status, 2)
    assert.equal(rejected.stats.connects, 0)
  } finally { space.cleanup() }
})

test('resume authenticates and hashes old objects; tampered ciphertext is preserved and refetched', () => {
  const space = workspace()
  try {
    const files = synthetic(12)
    writeInventory(space, { files: rows(files) })
    assert.equal(run(space, files).summary.complete_snapshot, true)
    const [tampered, missing] = ['public_html/images/f0003.php', 'public_html/images/f0007.php']
    const tamperedFile = path.join(objectsDir(space), objectName(tampered))
    const bytes = readFileSync(tamperedFile); bytes[24] ^= 0x01; writeFileSync(tamperedFile, bytes)
    rmSync(path.join(objectsDir(space), objectName(missing)))

    const second = run(space, files)
    assert.equal(second.status, 0, second.output)
    assert.deepEqual(second.stats.retr, { [tampered]: 1, [missing]: 1 })
    assert.equal(second.summary.resumed, 10)
    assert.equal(second.summary.downloaded, 2)
    assert.equal(second.summary.complete_snapshot, true)
    const preserved = readdirSync(objectsDir(space)).filter(name => name.startsWith(objectName(tampered).slice(0, -4) + '.corrupt-'))
    assert.equal(preserved.length, 1)
    assert.deepEqual(readFileSync(path.join(objectsDir(space), preserved[0])), bytes)
    assert.equal(openObject(space, tampered).plain.toString(), files[tampered].data)
  } finally { space.cleanup() }
})

test('a tampered manifest stops the run before any connection and is left untouched', () => {
  const space = workspace()
  try {
    const files = synthetic(3)
    writeInventory(space, { files: rows(files) })
    run(space, files)
    const manifestPath = path.join(space.dest, 'download-manifest.enc')
    const bytes = readFileSync(manifestPath); bytes[bytes.length - 20] ^= 0x01; writeFileSync(manifestPath, bytes)
    const result = run(space, files)
    assert.equal(result.status, 1)
    assert.equal(result.summary.error_type, 'InvalidTag')
    assert.equal(result.stats.connects, 0)
    assert.deepEqual(readFileSync(manifestPath), bytes)
  } finally { space.cleanup() }
})

test('SIGTERM stops dispatch, closes sockets and saves a checkpoint that resumes exactly', () => {
  const space = workspace()
  try {
    const files = synthetic(80, { delay: 0.02 })
    writeInventory(space, { files: rows(files) })
    const first = run(space, files, { kill_after: 15 })
    assert.equal(first.status, 128 + 15, first.output)
    assert.equal(first.summary.finished, false)
    assert.equal(first.summary.stop_reason, 'interrupted')
    assert.equal(first.stats.open, 0)
    assert.equal(first.stats.threads_alive, 0)
    assert.equal(first.summary.abandoned_threads, 0)
    assert.ok(first.stats.retr_total < 80, 'dispatch did not stop')
    assertNoParts(space)
    const report = manifest(space)
    assert.equal(report.complete_snapshot, false)
    assert.equal(report.stop_reason, 'interrupted')
    const done = report.files.filter((record: any) => record.complete)
    assert.ok(done.length >= 10 && done.length < 80)
    assert.ok(report.files.every((record: any) => record.complete), 'interruption is not a file failure')
    for (const record of done) assert.equal(sha(openObject(space, record.path).plain), record.sha256)

    const second = run(space, files)
    assert.equal(second.status, 0, second.output)
    assert.equal(second.summary.complete_snapshot, true)
    assert.equal(second.summary.resumed, done.length)
    assert.equal(second.summary.downloaded, 80 - done.length)
    assert.ok(Object.keys(second.stats.retr).every(p => !done.some((record: any) => record.path === p)))
  } finally { space.cleanup() }
})

test('a transfer stuck in a socket read is cut after the grace period', () => {
  const space = workspace()
  try {
    const files = { 'public_html/images/a-stuck.bin': { data: 'x'.repeat(64), hang: true }, ...synthetic(4) }
    writeInventory(space, { files: rows(files) })
    const result = run(space, files, { kill_after: 1, grace: 0.5, argv: ['--connections', '1'] })
    assert.equal(result.status, 128 + 15, result.output)
    assert.equal(result.stats.interrupts, 1)
    assert.ok(result.stats.elapsed < 10)
    assert.equal(result.stats.open, 0)
    assert.equal(result.stats.threads_alive, 0)
    assertNoParts(space)
    assert.ok(!manifest(space).files.some((record: any) => record.path === 'public_html/images/a-stuck.bin'))
  } finally { space.cleanup() }
})

test('failed files are recorded accurately, connections are dropped, and a later run retries them', () => {
  const space = workspace()
  try {
    const files: Record<string, Spec> = {
      ...synthetic(6),
      'public_html/flaky.txt': { data: 'flaky', fail: 2, fail_kind: 'reset' },
      'public_html/denied.txt': { data: 'denied', fail: -1, fail_kind: 'perm' },
      'public_html/moving.txt': { data: 'moving', changing: true },
    }
    writeInventory(space, { files: rows(files) })
    const first = run(space, files)
    assert.equal(first.status, 0, first.output)
    assert.equal(first.summary.finished, true)
    assert.equal(first.summary.complete_snapshot, false)
    assert.equal(first.summary.failures, 2)
    assert.equal(first.stats.retr['public_html/flaky.txt'], 3)
    assert.equal(first.stats.retr['public_html/denied.txt'], 3)
    assert.ok(first.stats.closes >= 2 + 3 + 3, 'each failed attempt must drop its connection')
    assertNoParts(space)
    const byPath = (report: any) => Object.fromEntries(report.files.map((record: any) => [record.path, record]))
    let records = byPath(manifest(space))
    assert.equal(records['public_html/flaky.txt'].complete, true)
    assert.deepEqual(records['public_html/denied.txt'], { path: 'public_html/denied.txt', complete: false, error_type: 'error_perm', attempts: 3, inventory_bytes: 6 })
    assert.equal(records['public_html/moving.txt'].error_type, 'SourceChanged')
    assert.ok(!existsSync(path.join(objectsDir(space), objectName('public_html/denied.txt'))))

    const fixed = { ...files, 'public_html/denied.txt': { data: 'denied' }, 'public_html/moving.txt': { data: 'moving' } }
    const second = run(space, fixed)
    assert.equal(second.summary.complete_snapshot, true)
    assert.equal(second.summary.failures, 0)
    assert.deepEqual(Object.keys(second.stats.retr).sort(), ['public_html/denied.txt', 'public_html/moving.txt'])
    records = byPath(manifest(space))
    assert.equal(records['public_html/denied.txt'].complete, true)
    assert.equal(records['public_html/denied.txt'].error_type, undefined)
  } finally { space.cleanup() }
})

test('authentication and certificate failures are tried once, never per connection or in a loop', () => {
  for (const [options, expected] of [[{ connect_error: 'auth' }, 'error_perm'], [{ connect_error: 'cert' }, 'SSLCertVerificationError']] as const) {
    const space = workspace()
    try {
      const files = synthetic(10)
      writeInventory(space, { files: rows(files) })
      const wrong = options.connect_error === 'auth' ? JSON.stringify({ key: space.key.toString('base64'), password: Buffer.from('wrong-' + space.password).toString('base64') }) + '\n' : undefined
      const result = run(space, files, options, wrong)
      assert.equal(result.status, 1, result.output)
      assert.equal(result.stats.connects, 1)
      assert.equal(result.summary.stop_reason, expected)
      const report = manifest(space)
      assert.equal(report.stop_reason, expected)
      assert.equal(report.files.length, 0, 'an auth failure is not a file failure')
      assert.ok(!result.output.includes(space.password))
    } finally { space.cleanup() }
  }
  const space = workspace()
  try {
    const files = synthetic(6)
    writeInventory(space, { files: rows(files) })
    const result = run(space, files, { connect_error: 'temp', connect_temp_failures: 2 })
    assert.equal(result.summary.complete_snapshot, true, result.output)
  } finally { space.cleanup() }
})

test('complete_snapshot needs a complete inventory, exact coverage and no changes or gaps', () => {
  const cases: Array<[string, (files: Record<string, Spec>) => Inventory]> = [
    ['inventory flag false', files => ({ files: rows(files), complete_inventory: false })],
    ['inaccessible directory', files => ({ files: rows(files), skipped: [{ path: 'public_html/private', reason: 'inaccessible-directory' }] })],
    ['changed since inventory', files => ({ files: rows(files).map((row, i) => i === 0 ? { ...row, size: row.size + 1 } : row) })],
  ]
  for (const [label, inventory] of cases) {
    const space = workspace()
    try {
      const files = synthetic(5)
      writeInventory(space, inventory(files))
      const result = run(space, files)
      assert.equal(result.status, 0, label + ': ' + result.output)
      assert.equal(result.summary.finished, true, label)
      assert.equal(result.summary.files, 5, label)
      assert.equal(result.summary.complete_snapshot, false, label)
      assert.equal(manifest(space).database_snapshot, false, label)
    } finally { space.cleanup() }
  }
  const space = workspace()
  try {
    const files = { ...synthetic(3), 'public_html/.env.local': { data: 'SECRET=1' }, 'vmfiles/.bash_history': { data: 'history' } }
    writeInventory(space, { files: rows(files) })
    const result = run(space, files)
    assert.equal(result.summary.complete_snapshot, false)
    assert.equal(result.stats.retr['public_html/.env.local'], undefined)
    assert.equal(result.stats.retr['vmfiles/.bash_history'], undefined)
    const report = manifest(space)
    assert.deepEqual(report.excluded.map((row: any) => row.path).sort(), ['public_html/.env.local', 'vmfiles/.bash_history'])
    assert.equal(report.files.length, 3)
  } finally { space.cleanup() }
})

test('unsafe paths, a held lock and the free-space reserve stop before any connection', () => {
  const scenarios: Array<[string, Record<string, unknown>, Row[] | null, string]> = [
    ['traversal', {}, [{ path: 'public_html/../etc/passwd', size: 1 }], 'PermissionError'],
    ['outside roots', {}, [{ path: 'logs/access.log', size: 1 }], 'PermissionError'],
    ['lock held', { hold_lock: true }, null, 'AlreadyRunning'],
  ]
  for (const [label, options, inventoryRows, expected] of scenarios) {
    const space = workspace()
    try {
      const files = synthetic(2)
      writeInventory(space, { files: inventoryRows ?? rows(files) })
      const result = run(space, files, options)
      assert.equal(result.status, 1, label)
      assert.equal(result.summary.error_type, expected, label)
      assert.equal(result.stats.connects, 0, label)
    } finally { space.cleanup() }
  }
  const space = workspace()
  try {
    const files = synthetic(2)
    writeInventory(space, { files: rows(files) })
    const result = run(space, files, { free_bytes: 4 * 1024 ** 3 })
    assert.equal(result.status, 1)
    assert.equal(result.summary.stop_reason, 'InsufficientSpace')
    assert.equal(result.stats.connects, 0)
    assert.deepEqual(readdirSync(objectsDir(space)), [])
    assert.equal(manifest(space).complete_snapshot, false)
  } finally { space.cleanup() }
})

test('credentials enter only through stdin and never reach output or the manifest', () => {
  const space = workspace()
  try {
    const files = synthetic(4)
    writeInventory(space, { files: rows(files) })
    const extra = JSON.stringify({ key: space.key.toString('base64'), password: Buffer.from(space.password).toString('base64'), user: 'x' }) + '\n'
    const rejected = run(space, files, {}, extra)
    assert.equal(rejected.summary.error_type, 'ValueError')
    assert.equal(rejected.stats.connects, 0)

    const result = run(space, files)
    assert.equal(result.summary.complete_snapshot, true)
    for (const secret of [space.password, Buffer.from(space.password).toString('base64'), space.key.toString('base64'), space.key.toString('hex')]) {
      assert.ok(!result.output.includes(secret))
      assert.ok(!JSON.stringify(manifest(space)).includes(secret))
      for (const name of readdirSync(space.dest)) {
        if (name !== 'objects') assert.ok(!readFileSync(path.join(space.dest, name)).includes(secret))
      }
    }
    const config = readFileSync(path.join(space.root, 'config.json'), 'utf8')
    assert.ok(!config.includes(space.password), 'the harness itself only knows a hash')
  } finally { space.cleanup() }
})

test('the connection class keeps the read-only command allowlist', () => {
  const probe = [
    "import sys; sys.path.insert(0, 'scripts/source'); import snapshot_worker as w",
    'ftp = w.TrackedFTP()',
    'blocked = []',
    "for line in ['DELE a', 'STOR a', 'APPE a', 'RNFR a', 'RNTO b', 'MKD a', 'RMD a', 'SITE CHMOD 777 a', 'SITE EXEC php a']:",
    '    try: ftp.putcmd(line)',
    '    except PermissionError: blocked.append(line)',
    'try: ftp.storbinary("STOR a", None)',
    'except PermissionError: blocked.append("storbinary")',
    "assert isinstance(ftp, w.ReadOnlyFTP) and w.TrackedFTP.ALLOWED == w.ReadOnlyFTP.ALLOWED",
    'print(len(blocked))',
  ].join('\n')
  const result = spawnSync(PYTHON, ['-c', probe], { encoding: 'utf8', env })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), '10')
  // Real local sockets: the shutdown hook must wake a thread blocked in recv.
  const cut = [
    "import socket, sys, threading, time; sys.path.insert(0, 'scripts/source'); import snapshot_worker as w",
    'ftp = w.TrackedFTP(); control, peer = socket.socketpair(); data, data_peer = socket.socketpair()',
    'ftp.sock = control; ftp.data_socket = data; got = []',
    'reader = threading.Thread(target=lambda: got.append(data.recv(1))); reader.start(); time.sleep(0.2)',
    'ftp.interrupt(); reader.join(3)',
    "print(reader.is_alive(), got == [b''], control.recv(1) == b'')",
  ].join('\n')
  const unblocked = spawnSync(PYTHON, ['-c', cut], { encoding: 'utf8', env, timeout: 10_000 })
  assert.equal(unblocked.status, 0, unblocked.stderr)
  assert.equal(unblocked.stdout.trim(), 'False True True')
  const source = readFileSync('scripts/source/snapshot_worker.py', 'utf8')
  for (const forbidden of ['subprocess', 'os.system', 'exec(', 'eval(', 'unlink(target', 'shutil.rmtree']) assert.ok(!source.includes(forbidden), forbidden)
})


test('inventory exclusions cannot be reported as a full file snapshot', () => {
  const space = workspace()
  try {
    const files = synthetic(2)
    writeInventory(space, { files: rows(files), skipped: [{ path: 'public_html/.env', reason: 'secret-environment-or-shell-history' }, { path: 'public_html/images-link', reason: 'symlink-not-followed' }] })
    const result = run(space, files)
    assert.equal(result.status, 0)
    assert.equal(result.summary.files, 2)
    assert.equal(result.summary.complete_snapshot, false)
    assert.equal(manifest(space).skipped.length, 2)
  } finally { space.cleanup() }
})
