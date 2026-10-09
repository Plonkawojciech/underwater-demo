import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { paymentProvider } from '../src/lib/commerce/payment-registry'
import { validateEnvironment } from '../src/lib/environment'
import { paymentProviderID } from '../src/lib/commerce/payment-selection'
import { fileURLToPath } from 'node:url'

test('the exact own-preview deployment configuration selects an implemented payment adapter', () => {
  const program = `
import runpy,json,sys,subprocess
from unittest.mock import patch
source=runpy.run_path('scripts/deploy/configure-preview.py',run_name='test_config')
captured={}
def remote(*args,**kwargs):
 assert args[0][0]=='ssh' and 'root@159.195.206.7' in args[0] and args[0][-1].startswith('docker exec -i coolify php -r ')
 captured.update(json.loads(kwargs['input']))
 return subprocess.CompletedProcess([],0,json.dumps({'configured':source['APP_UUID'],'runtimeOnly':True,'keys':list(captured)}).encode(),b'')
with patch.dict(source['main'].__globals__,{'value':lambda name:'synthetic-deployment-contract-secret-not-for-runtime'}),patch.object(subprocess,'run',side_effect=remote),patch.object(sys,'argv',['configure-preview','--apply']):
 import contextlib,io
 with contextlib.redirect_stdout(io.StringIO()):source['main']()
print(json.dumps(captured))
`
  const result = spawnSync('python3', ['-c', program], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  assert.equal(result.status, 0, result.stderr)
  const configured = JSON.parse(result.stdout)
  assert.equal(validateEnvironment(configured).environment, 'preview')
  const old = { ...process.env }
  try {
    Object.assign(process.env, configured)
    assert.equal(paymentProvider().id, configured.UNDERWATER_PAYMENT_PROVIDER)
    assert.equal(paymentProvider().mode, 'test')
  } finally {
    for (const key of Object.keys(configured)) {
      if (old[key] === undefined) delete process.env[key]
      else process.env[key] = old[key]
    }
  }
})

test('runtime refuses an unknown payment adapter before application startup', () => {
  assert.throws(() => validateEnvironment({
    UNDERWATER_ENVIRONMENT: 'test', UNDERWATER_DATA_ROOT: '/tmp/underwater-contract',
    DATABASE_URI: 'file:/tmp/underwater-contract/underwater-test.db', MEDIA_DIR: '/tmp/underwater-contract/media',
    NEXT_PUBLIC_SERVER_URL: 'http://localhost:3118', PAYLOAD_SECRET: 'synthetic-contract-secret-long-enough-for-unit-test',
    UNDERWATER_PAYMENT_PROVIDER: 'test',
  }), /payment/i)
  assert.equal(paymentProviderID(undefined), 'internal-test')
  for (const invalid of ['', 'test', 'production']) assert.throws(() => paymentProviderID(invalid), /payment/i)
})
