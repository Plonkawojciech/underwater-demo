import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

test('runtime refuses a nested or foreign data mount before invoking application code', () => {
  const program = `
import runpy,io,json,sys,subprocess
from unittest.mock import patch
source=runpy.run_path('scripts/deploy/runtime-preview.py',run_name='test_runtime')
app=source['APP'];commit='a'*40
valid={'Name':'/'+app+'-own','Id':'own','Config':{'Image':app+':'+commit},'Mounts':[{'Destination':'/data','Type':'volume','Name':app+'-underwater-data'}]}
cases=[]
for change in ['nested-bind','nested-volume','foreign-name','wrong-type','wrong-image']:
 d=json.loads(json.dumps(valid))
 if change.startswith('nested'):d['Mounts'].append({'Destination':'/data/preview','Type':'bind' if change=='nested-bind' else 'volume','Name':'foreign'})
 if change=='foreign-name':d['Mounts'][0]['Name']='foreign'
 if change=='wrong-type':d['Mounts'][0]['Type']='bind'
 if change=='wrong-image':d['Config']['Image']=app+':'+'b'*40
 with patch.object(subprocess,'check_output',side_effect=['own\\n',json.dumps([d])]),patch.object(subprocess,'run') as application,patch.object(sys,'stdin',io.StringIO(json.dumps({'commit':commit,'mode':'counts','javascript':'throw new Error("must not execute")'}))):
  try:exec(source['REMOTE_RUN'],{})
  except RuntimeError:cases.append({'case':change,'refused':True,'applicationCalled':application.called})
  else:raise AssertionError('An unauthorized target was accepted')
print(json.dumps(cases))
`
  const result = spawnSync('python3', ['-c', program], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  assert.equal(result.status, 0, result.stderr)
  const cases = JSON.parse(result.stdout)
  assert.equal(cases.length, 5)
  assert.ok(cases.every((scenario: { refused: boolean; applicationCalled: boolean }) => scenario.refused && !scenario.applicationCalled))
})
