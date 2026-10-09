import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

test('a frozen public-media checkpoint authenticates its source and does not overwrite evidence', () => {
  const bundled = '/Users/wojciechplonka/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3'
  const program = `
import sys,json,tempfile,hashlib,os
from pathlib import Path
sys.path.insert(0,'scripts/source')
from prepare_media_checkpoint import prepare
from inventory import encrypted_write
key=b't'*32
def fixture(root,change=None):
 source=root/'20261008-import-public';media=source/'media';media.mkdir(parents=True)
 (root/'20261008-public').mkdir()
 (media/'image.jpg').write_bytes(b'synthetic-source-image')
 row={'key':'public-media:1','path':'image.jpg','sha256':hashlib.sha256(b'synthetic-source-image').hexdigest(),'url':'https://www.underwater.pl/images/image.jpg','alt':'Synthetic test'}
 rows=[row]
 if change=='escape':row['path']='../outside.jpg'
 if change=='changed':(media/'image.jpg').write_bytes(b'changed-source')
 if change=='duplicate':rows.append(dict(row))
 if change=='symlink':(media/'image.jpg').unlink();(root/'outside.jpg').write_bytes(b'synthetic-source-image');(media/'image.jpg').symlink_to(root/'outside.jpg')
 encrypted_write(source/'media-manifest.enc',{'files':rows},key)
 encrypted_write(root/'20261008-public/pages-manifest.enc',{'started_at':'2026-10-08T18:53:00Z'},key)
 if change=='tamper':
  p=source/'media-manifest.enc';data=bytearray(p.read_bytes());data[-1]^=1;p.write_bytes(data)
results=[]
for change in ['escape','changed','duplicate','symlink','tamper']:
 with tempfile.TemporaryDirectory(prefix='underwater-media-guard-test-') as d:
  root=Path(d);fixture(root,change)
  try:prepare(root,key)
  except Exception:results.append({'case':change,'refused':True,'outputCreated':(root/'20261008-import-public-media/bundle.json').exists()})
  else:raise AssertionError('Unsafe checkpoint was accepted')
with tempfile.TemporaryDirectory(prefix='underwater-media-guard-test-') as d:
 root=Path(d);fixture(root);report=prepare(root,key);output=root/'20261008-import-public-media/bundle.json';before=output.read_bytes();bundle=json.loads(before)
 try:prepare(root,key)
 except FileExistsError:preserved=output.read_bytes()==before
 else:raise AssertionError('Existing checkpoint was overwritten')
 print(json.dumps({'refused':results,'report':{k:v for k,v in report.items() if k!='output'},'entities':len(bundle['entities']),'media':len(bundle['media']),'preserved':preserved,'sourceComplete':bundle['source']['complete']}))
`
  const result = spawnSync(existsSync(bundled) ? bundled : 'python3', ['-c', program], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.refused.length, 5)
  assert.ok(output.refused.every((row: { refused: boolean; outputCreated: boolean }) => row.refused && !row.outputCreated))
  assert.equal(output.entities, 0)
  assert.equal(output.media, 1)
  assert.equal(output.preserved, true)
  assert.equal(output.sourceComplete, false)
})
