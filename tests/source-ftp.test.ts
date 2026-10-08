import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

test('the source FTP wrapper rejects upload, deletion, rename and server commands before I/O', () => {
  const result = spawnSync('python3', ['-c', [
    'import importlib.util',
    "spec=importlib.util.spec_from_file_location('reader','scripts/source/ftp_readonly.py')",
    'module=importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'client=module.ReadOnlyFTP()',
    "for command in ['STOR x','DELE x','RMD x','MKD x','RNFR x','RNTO x','SITE CHMOD 777 x','APPE x']:",
    ' try: client.putcmd(command)',
    ' except PermissionError: pass',
    " else: raise AssertionError('Mutation reached I/O')",
    "print('READ_ONLY_GUARD_OK')",
  ].join('\n')], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /READ_ONLY_GUARD_OK/)
})
