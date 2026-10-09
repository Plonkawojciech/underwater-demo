"""Configure only the authorized own Coolify app; runtime secrets travel via stdin.
No source FTP/database secret is ever part of the application environment.
"""
import argparse
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import base64

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'source'))
from keychain import read_secret, add_secret

APP_UUID = 'qpf9uvw5p9hky4sn5vamun36'
REMOTE = 'root@159.195.206.7'
IDENTITY = str(Path.home() / '.ssh/netcup_rs2000')
SERVICE = 'programo.underwater.preview.'
PHP = r'''
require '/var/www/html/vendor/autoload.php';
$app=require '/var/www/html/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$input=json_decode(stream_get_contents(STDIN),true,512,JSON_THROW_ON_ERROR);
$a=App\Models\Application::findOrFail(15);
if($a->uuid!=='qpf9uvw5p9hky4sn5vamun36' || $a->git_branch!=='main')throw new Exception('Wrong authorized target');
Illuminate\Support\Facades\DB::transaction(function()use($a,$input){
 foreach($input as $key=>$value){
  if($a->environment_variables()->where('key',$key)->count()>1)throw new Exception('Duplicate runtime key');
  $v=$a->environment_variables()->firstOrNew(['key'=>$key,'is_preview'=>false]);
  $v->value=$value; $v->is_runtime=true; $v->is_buildtime=false;
  $v->is_multiline=false; $v->is_literal=true; $v->is_shown_once=false; $v->save();
 }
});
echo json_encode(['configured'=>$a->uuid,'keys'=>array_keys($input),'runtimeOnly'=>true]);
'''

def value(name):
    service = SERVICE + name
    existing = read_secret(service)
    if existing is None:
        existing = base64.urlsafe_b64encode(os.urandom(48)).rstrip(b'=')
        add_secret(service, existing)
    return existing.decode('ascii')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    names = ['payload-secret', 'basic-password', 'admin-password']
    if not args.apply:
        print(json.dumps({'authorizedApplication': APP_UUID, 'database': '/data/preview/underwater-preview.db', 'keychainServices': [SERVICE + n for n in names], 'mutated': False}))
        return
    # Separate new runtime data. Preserve /data/payload.db and /data/media of the original demo.
    environment = {
        'UNDERWATER_ENVIRONMENT': 'preview', 'UNDERWATER_DATA_ROOT': '/data/preview',
        'DATABASE_URI': 'file:/data/preview/underwater-preview.db', 'MEDIA_DIR': '/data/preview/media',
        'UNDERWATER_ORIGIN': 'https://underwater-demo.programo.pl',
        'NEXT_PUBLIC_SERVER_URL': 'https://underwater-demo.programo.pl',
        'PAYLOAD_SECRET': value('payload-secret'), 'UNDERWATER_PREVIEW_USER': 'wojtek-underwater',
        'UNDERWATER_PREVIEW_PASSWORD': value('basic-password'),
        'UNDERWATER_ADMIN_EMAIL': 'underwater-preview@programo.pl',
        'UNDERWATER_PAYMENT_PROVIDER': 'internal-test',
    }
    expected_keys = set(environment)
    value('admin-password')  # Bootstrap uses stdin in a separate operation; never a persistent container variable.
    command = 'docker exec -i coolify php -r ' + shlex.quote(PHP)
    completed = subprocess.run(['ssh', '-i', IDENTITY, '-o', 'BatchMode=yes', REMOTE, command], input=json.dumps(environment).encode(), capture_output=True)
    del environment
    if completed.returncode:
        # Do not print provider traces that might interpolate secret input.
        raise RuntimeError('Own Coolify configuration failed; credentials were not printed.')
    report = json.loads(completed.stdout)
    if report.get('configured') != APP_UUID or report.get('runtimeOnly') is not True or set(report.get('keys', [])) != expected_keys: raise ValueError('Unexpected configuration target or result.')
    print(json.dumps(report))


if __name__ == '__main__': main()
