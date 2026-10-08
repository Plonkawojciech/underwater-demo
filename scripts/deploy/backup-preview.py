"""Run encrypted backup and restore proof on our own VM; keys only Keychain/stdin."""
import argparse
import base64
from datetime import datetime, timezone
import json
from pathlib import Path
import shlex
import subprocess
import sys
import os

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'source'))
from keychain import read_secret, add_secret

REMOTE = 'root@159.195.206.7'
IDENTITY = str(Path.home() / '.ssh/netcup_rs2000')
SERVICE = 'programo.underwater.preview.backup-key'
VOLUME = '/var/lib/docker/volumes/qpf9uvw5p9hky4sn5vamun36-underwater-data/_data'
BASE = '/root/underwater/backups'
OLD = BASE + '/20261008T190743Z-before-implementation'
SCRIPT = '/root/underwater/tools/underwater_backup.py'


def ssh(command, input=None):
    result = subprocess.run(['ssh', '-i', IDENTITY, '-o', 'BatchMode=yes', REMOTE, command], input=input, capture_output=True)
    if result.returncode:
        raise RuntimeError('Own VM backup operation failed: ' + result.stderr.decode()[:500])
    return result.stdout


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--legacy-demo-check', action='store_true')
    args = parser.parse_args()
    key = read_secret(SERVICE)
    if key is None:
        key = os.urandom(32)
        add_secret(SERVICE, key)
    if len(key) != 32: raise ValueError('Unexpected private backup key format.')
    supplied = json.dumps({'key': base64.b64encode(key).decode()}).encode()
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    ssh('mkdir -p /root/underwater/tools && chmod 700 /root/underwater/tools')
    subprocess.run(['scp', '-i', IDENTITY, str(Path(__file__).resolve().parents[1] / 'backup/underwater_backup.py'), REMOTE + ':' + SCRIPT], check=True, capture_output=True)
    source = VOLUME + '/preview'
    environment = 'preview'
    if args.legacy_demo_check:
        environment = 'test'
        source = BASE + '/' + stamp + '-legacy-verification-data'
        # Copy only our known pre-implementation backup into a new isolated fixture.
        prepare = r'''
from pathlib import Path
import shutil,tarfile,os
source=Path(SOURCE);old=Path(OLD)
source.mkdir(mode=0o700);shutil.copy2(old/'payload.db',source/'underwater-test.db');os.chmod(source/'underwater-test.db',0o600)
with tarfile.open(old/'media.tar.gz') as archive:
 for member in archive.getmembers():
  p=Path(member.name)
  if p.is_absolute() or '..' in p.parts or member.issym() or member.islnk() or not(member.isfile() or member.isdir()):raise ValueError('Unsafe own demo archive')
 archive.extractall(source,filter='data')
'''.replace('SOURCE', repr(source)).replace('OLD', repr(OLD))
        ssh('python3 -c ' + shlex.quote(prepare))
    destination = BASE + '/' + stamp + '-' + environment + '-encrypted'
    command = ['python3', SCRIPT, 'backup', '--data-root', source, '--environment', environment, '--destination', destination]
    backup = json.loads(ssh(shlex.join(command), supplied))
    restore_target = BASE + '/' + stamp + '-' + environment + '-restore-proof'
    command = ['python3', SCRIPT, 'restore', '--archive', backup['archive'], '--destination', restore_target]
    restored = json.loads(ssh(shlex.join(command), supplied))
    for section in ['database', 'media']:
        for name in (['tables', 'rows', 'latest_migration'] if section == 'database' else ['files', 'bytes']):
            if backup[section][name] != restored[section][name]: raise ValueError('Own restore proof does not match its backup.')
    if restored['database']['integrity'] != 'ok': raise ValueError('Own restore integrity check failed.')
    print(json.dumps({'backup': backup, 'restore': restored, 'ownVMOnly': True, 'legacyDemoCheck': args.legacy_demo_check}))


if __name__ == '__main__': main()
