import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const bundled = '/Users/wojciechplonka/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3'

// Synthetic fixtures only: a fixed 32-byte key, temporary directories, no Keychain and no sockets.
const program = `
import sys,json,tempfile,hashlib,os,stat,socket
from pathlib import Path
sys.path.insert(0,'scripts/source')
import keychain
def no_keychain(*a,**k): raise AssertionError('Keychain touched')
keychain.snapshot_key=keychain.read_secret=no_keychain
connects=[]
def no_network(*a,**k): connects.append(a); raise AssertionError('network attempted')
socket.socket.connect=no_network; socket.create_connection=no_network
import media_cache
from media_cache import acquire, unique_path, write_archive, archive_object, CacheIntegrityError, CacheConflict
from inventory import encrypted_write, decrypt_manifest
KEY=bytes(range(32))
writes=[]
real_write=media_cache.encrypted_write
def counted(*a): writes.append(1); return real_write(*a)
media_cache.encrypted_write=counted
sha=lambda b: hashlib.sha256(b).hexdigest()
URL='https://www.underwater.pl/'
SOURCES={'A':'images/Foo.jpg','B':'images/foo.JPG','C':'images/a/same.png','D':'images/b/same.png'}
BODY={name:('synthetic-'+name).encode()*(50+i) for i,name in enumerate('ABCDG')}
FAILED=[{'key':'k-E','error_type':'HTTPError'},{'key':'k-F','error_type':'URLError'}]
def rows(extra=()):
 return [{'key':'k-'+n,'path':p,'url':URL+p,'alt':'alt '+n} for n,p in [*SOURCES.items(),('E','images/e.jpg'),('F','images/f.jpg'),*extra]]
def fixture(root):
 media=root/'media';archive=root/'media-encrypted';media.mkdir();archive.mkdir()
 (media/'images/a').mkdir(parents=True)
 # Legacy case-insensitive staging: A and B shared one file and B overwrote A.
 (media/'images/foo.jpg').write_bytes(BODY['B'])
 (media/'images/a/same.png').write_bytes(BODY['C'])
 for n in 'ABD': write_archive(archive,KEY,URL+SOURCES[n],sha(BODY[n]),BODY[n])
 legacy={'A':'images/foo.jpg','B':'images/foo.jpg','C':'images/a/same.png','D':'images/b/same.png'}
 files=[{'key':'k-'+n,'path':legacy[n],'sha256':sha(BODY[n]),'alt':'old','url':URL+SOURCES[n]} for n in 'ABCD']
 state={'files':files,'failed':[dict(f) for f in FAILED]}
 encrypted_write(root/'media-manifest.enc',state,KEY)
 return media,archive,state
def run(root,media,archive,state,fetch=None,**options):
 calls=[]
 def fetcher(row): calls.append(row['key']); return (fetch or {}).get(row['key'])
 out=acquire(rows(options.pop('extra',())),state,root/'media-manifest.enc',media,archive,KEY,fetcher=fetcher,**options)
 return out,calls
def tree(path):
 return {str(p.relative_to(path)):(os.readlink(p) if p.is_symlink() else sha(p.read_bytes()) if p.is_file() else 'dir') for p in sorted(path.rglob('*'))}
result={}
with tempfile.TemporaryDirectory(prefix='underwater-media-cache-test-') as d:
 root=Path(d);media,archive,state=fixture(root);archive_before=tree(archive)
 writes.clear();out,calls=run(root,media,archive,state,cached_only=True)
 manifest=decrypt_manifest(root/'media-manifest.enc',KEY)
 paths={row['key']:row['path'] for row in out}
 result['replay']={
  'calls':calls,'writes':len(writes),'media':len(out),
  'exact':all((media/unique_path('k-'+n,SOURCES[n])).read_bytes()==BODY[n] for n in 'ABCD'),
  'distinctPaths':len(set(paths.values()))==4 and all(paths['k-'+n]==unique_path('k-'+n,SOURCES[n]) for n in 'ABCD'),
  'modes':sorted({oct(stat.S_IMODE(os.lstat(media/p).st_mode)) for p in paths.values()}),
  'legacyKept':(media/'images/foo.jpg').read_bytes()==BODY['B'] and (media/'images/a/same.png').read_bytes()==BODY['C'],
  'archiveUnchanged':tree(archive)==archive_before,
  'failedUnchanged':manifest['failed']==FAILED,
  'manifestPaths':{r['key']:r['path'] for r in manifest['files']}=={k:v for k,v in paths.items()},
  'fields':sorted({tuple(sorted(r)) for r in manifest['files']}),
  'shaKept':all(r['sha256']==sha(BODY[r['key'][2:]]) for r in manifest['files']),
  'bundleAlt':[r['alt'] for r in out],
  'noTemp':not any(p.name.startswith('.') for p in media.rglob('*')),
 }
 writes.clear();again,calls=run(root,media,archive,decrypt_manifest(root/'media-manifest.enc',KEY),cached_only=True)
 result['second']={'calls':calls,'writes':len(writes),'same':again==out,'failedUnchanged':decrypt_manifest(root/'media-manifest.enc',KEY)['failed']==FAILED}
 # New source only; archived failures are not retried; an occupied unique path is refused.
 occupied=media/unique_path('k-H','images/h.webp');occupied.write_bytes(b'other-evidence')
 writes.clear();out,calls=run(root,media,archive,decrypt_manifest(root/'media-manifest.enc',KEY),fetch={'k-G':BODY['G'],'k-H':b'new-h'},skip_known_failures=True,extra=[('G','images/g.GIF'),('H','images/h.webp')])
 manifest=decrypt_manifest(root/'media-manifest.enc',KEY)
 g=next(r for r in manifest['files'] if r['key']=='k-G')
 blob=archive_object(archive,URL+'images/g.GIF',sha(BODY['G'])).read_bytes()
 from cryptography.hazmat.primitives.ciphers.aead import AESGCM
 result['skipKnown']={'calls':sorted(calls),'media':len(out),'gPath':g['path']==unique_path('k-G','images/g.GIF') and g['path'].endswith('.gif'),
  'gExact':(media/g['path']).read_bytes()==BODY['G'],'gArchived':AESGCM(KEY).decrypt(blob[6:18],blob[18:],(URL+'images/g.GIF').encode())==BODY['G'],
  'conflictKept':occupied.read_bytes()==b'other-evidence','failed':manifest['failed']}
def refused(name,prepare,expect):
 with tempfile.TemporaryDirectory(prefix='underwater-media-cache-test-') as d:
  root=Path(d);media,archive,state=fixture(root)
  watch=prepare(root,media,archive)
  outside=lambda: sorted(p.name for p in (root/'outside').iterdir()) if (root/'outside').is_dir() else []
  outside_before=outside()
  before={p:(os.readlink(p) if p.is_symlink() else p.read_bytes()) for p in watch}
  target=media/unique_path('k-A',SOURCES['A'])
  existed=target.exists() or target.is_symlink()
  try: run(root,media,archive,state,cached_only=True)
  except expect: pass
  else: raise AssertionError(name+' was accepted')
  after={p:(os.readlink(p) if p.is_symlink() else p.read_bytes()) for p in watch}
  return {'case':name,'preserved':after==before,'targetCreated':(target.exists() or target.is_symlink()) and not existed,'escaped':outside()!=outside_before}
def wrong_tag(root,media,archive):
 p=archive_object(archive,URL+SOURCES['A'],sha(BODY['A']));b=bytearray(p.read_bytes());b[-1]^=1;p.write_bytes(b);return [p]
def wrong_sha(root,media,archive):
 p=archive_object(archive,URL+SOURCES['A'],sha(BODY['A']));p.unlink()
 nonce=b'n'*12
 from cryptography.hazmat.primitives.ciphers.aead import AESGCM
 p.write_bytes(b'UWENC1'+nonce+AESGCM(KEY).encrypt(nonce,b'substituted',(URL+SOURCES['A']).encode()));return [p]
def conflict(root,media,archive):
 t=media/unique_path('k-A',SOURCES['A']);t.write_bytes(b'different-bytes');return [t]
def symlink_target(root,media,archive):
 (root/'outside').mkdir();o=root/'outside/victim.jpg';o.write_bytes(b'victim')
 t=media/unique_path('k-A',SOURCES['A']);t.symlink_to(o);return [t,o]
def symlink_dir(root,media,archive):
 (root/'outside').mkdir()
 for p in sorted((media/'images').rglob('*'),reverse=True): p.unlink() if p.is_file() else p.rmdir()
 (media/'images').rmdir();(media/'images').symlink_to(root/'outside');return [media/'images']
result['refused']=[refused('wrong-tag',wrong_tag,CacheIntegrityError),refused('wrong-sha',wrong_sha,CacheIntegrityError),refused('conflict',conflict,CacheConflict),refused('symlink-target',symlink_target,CacheIntegrityError),refused('symlink-directory',symlink_dir,CacheIntegrityError)]
# Unsafe or symlinked legacy paths are never read or followed; the archive is used instead.
with tempfile.TemporaryDirectory(prefix='underwater-media-cache-test-') as d:
 root=Path(d);media,archive,state=fixture(root)
 (root/'outside.png').write_bytes(BODY['C'])
 (media/'images/a/same.png').unlink();(media/'images/a/same.png').symlink_to(root/'outside.png')
 state['files'][3]['path']='../outside.png'
 out,calls=run(root,media,archive,state,cached_only=True)
 failed=decrypt_manifest(root/'media-manifest.enc',KEY)['failed']
 result['legacyGuards']={'media':sorted(r['key'] for r in out),'calls':calls,'cNotFollowed':not (media/unique_path('k-C',SOURCES['C'])).exists(),'cFailure':[f for f in failed if f['key']=='k-C'],'dFromArchive':(media/unique_path('k-D',SOURCES['D'])).read_bytes()==BODY['D'],'outsideKept':(root/'outside.png').read_bytes()==BODY['C']}
# Bounded manifest checkpoints instead of one rewrite per restored file.
with tempfile.TemporaryDirectory(prefix='underwater-media-cache-test-') as d:
 root=Path(d);media,archive,state=fixture(root);media_cache.CHECKPOINT=2
 writes.clear();run(root,media,archive,state,cached_only=True);result['checkpointWrites']=len(writes)
unsafe=[]
for path in ['images/x.exe','images/x','images/x.jpg.php']:
 try: unique_path('k',path)
 except ValueError: unsafe.append(path)
result['unsafeExtensions']=unsafe
result['connects']=len(connects)
print(json.dumps(result))
`

test('cached media replay restores colliding keys to unique paths from authenticated evidence without network', () => {
  const run = spawnSync(existsSync(bundled) ? bundled : 'python3', ['-c', program], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  assert.equal(run.status, 0, run.stderr)
  const result = JSON.parse(run.stdout.trim().split('\n').at(-1)!)

  const replay = result.replay
  assert.deepEqual(replay.calls, [])
  assert.equal(replay.writes, 1, 'one manifest boundary for all restored files')
  assert.equal(replay.media, 4)
  assert.equal(replay.exact, true, 'A recovered from the archive although the shared legacy file held B')
  assert.equal(replay.distinctPaths, true)
  assert.deepEqual(replay.modes, ['0o600'])
  assert.equal(replay.legacyKept, true)
  assert.equal(replay.archiveUnchanged, true)
  assert.equal(replay.failedUnchanged, true)
  assert.equal(replay.manifestPaths, true)
  assert.deepEqual(replay.fields, [['alt', 'key', 'path', 'sha256', 'url']])
  assert.equal(replay.shaKept, true)
  assert.deepEqual(replay.bundleAlt, ['alt A', 'alt B', 'alt C', 'alt D'])
  assert.equal(replay.noTemp, true)

  assert.deepEqual(result.second, { calls: [], writes: 0, same: true, failedUnchanged: true })

  const skip = result.skipKnown
  assert.deepEqual(skip.calls, ['k-G', 'k-H'], 'archived HTTP/URL failures are not retried')
  assert.equal(skip.media, 5)
  assert.equal(skip.gPath, true)
  assert.equal(skip.gExact, true)
  assert.equal(skip.gArchived, true)
  assert.equal(skip.conflictKept, true)
  assert.deepEqual(skip.failed, [{ key: 'k-E', error_type: 'HTTPError' }, { key: 'k-F', error_type: 'URLError' }, { key: 'k-H', error_type: 'CacheConflict' }])

  assert.equal(result.refused.length, 5)
  for (const row of result.refused) assert.deepEqual(row, { case: row.case, preserved: true, targetCreated: false, escaped: false })

  const guards = result.legacyGuards
  assert.deepEqual(guards.media, ['k-A', 'k-B', 'k-D'])
  assert.deepEqual(guards.calls, [])
  assert.equal(guards.cNotFollowed, true)
  assert.deepEqual(guards.cFailure, [{ key: 'k-C', error_type: 'FileNotFoundError' }])
  assert.equal(guards.dFromArchive, true)
  assert.equal(guards.outsideKept, true)

  assert.equal(result.checkpointWrites, 2)
  assert.deepEqual(result.unsafeExtensions, ['images/x.exe', 'images/x', 'images/x.jpg.php'])
  assert.equal(result.connects, 0)
})
