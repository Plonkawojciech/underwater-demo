import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

test('public image prefetch bounds concurrent requests, keeps source order and joins its workers', () => {
  const bundled = '/Users/wojciechplonka/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3'
  const program = `
import sys,json,time,threading
sys.path.insert(0,'scripts/source')
from public_media_fetch import prefetch
active=0;peak=0;calls=[];lock=threading.Lock()
def fetch(row):
 global active,peak
 with lock:active+=1;peak=max(peak,active);calls.append(row['key'])
 try:
  time.sleep(.04 if row['key']%2 else .08)
  if row['key']==3:raise ValueError('synthetic failure')
  return bytes([row['key']])
 finally:
  with lock:active-=1
rows=[{'key':n} for n in range(10)]
output=[]
for i,row,cached,body,error in prefetch(rows,lambda row:{'cached':True} if row['key']==2 else None,fetch):
 output.append([i,bool(cached),list(body) if body else None,type(error).__name__ if error else None])
full_active=active
iterator=prefetch(rows,lambda row:None,fetch)
next(iterator);iterator.close()
print(json.dumps({'output':output,'peak':peak,'fullActive':full_active,'closedActive':active,'firstCalls':calls[:9]}))
`
  const result = spawnSync(existsSync(bundled) ? bundled : 'python3', ['-c', program], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.deepEqual(output.output.map((row: unknown[]) => row[0]), Array.from({ length: 10 }, (_, i) => i))
  assert.deepEqual(output.output[2], [2, true, null, null])
  assert.deepEqual(output.output[3], [3, false, null, 'ValueError'])
  assert.equal(output.firstCalls.includes(2), false)
  assert.equal(output.peak, 3)
  assert.equal(output.fullActive, 0)
  assert.equal(output.closedActive, 0)
})
