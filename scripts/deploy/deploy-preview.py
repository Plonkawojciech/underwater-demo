"""Queue/read a reviewed commit deployment of the one authorized own Coolify app."""
import argparse
import json
from pathlib import Path
import re
import shlex
import subprocess
import uuid

REMOTE = 'root@159.195.206.7'
IDENTITY = str(Path.home() / '.ssh/netcup_rs2000')
PHP = r'''
require '/var/www/html/vendor/autoload.php';
$app=require '/var/www/html/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$i=json_decode(stream_get_contents(STDIN),true,512,JSON_THROW_ON_ERROR);
$a=App\Models\Application::findOrFail(15);
if($a->uuid!=='qpf9uvw5p9hky4sn5vamun36'||$a->git_branch!=='main')throw new Exception('Wrong authorized target');
$queued=[];
if($i['mode']==='queue'){
 if(!preg_match('/^[a-f0-9]{40}$/',$i['commit']))throw new Exception('A concrete commit is required');
 $queued=queue_application_deployment($a,$i['deployment_uuid'],commit:$i['commit'],is_api:true);
}
$uuid=$queued['deployment_uuid']??$i['deployment_uuid'];
$query=App\Models\ApplicationDeploymentQueue::where('application_id',15);
$d=$i['mode']==='latest'?$query->where('commit',$i['commit'])->orderByDesc('id')->first():$query->where('deployment_uuid',$uuid)->first();
echo json_encode(['application'=>$a->uuid,'deployment'=>$d?->deployment_uuid,
 'commit'=>$d?->commit,'status'=>$d?->status,'admission'=>$queued['status']??null,'createdAt'=>$d?->created_at,'updatedAt'=>$d?->updated_at]);
'''

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['queue', 'status', 'latest'])
    parser.add_argument('value', help='40-character reviewed commit for queue; deployment UUID for status')
    args = parser.parse_args()
    if args.mode in {'queue', 'latest'}:
        if not re.fullmatch(r'[a-f0-9]{40}', args.value): raise ValueError('A concrete commit is required.')
        data = {'mode': args.mode, 'commit': args.value, 'deployment_uuid': str(uuid.uuid4())}
    else:
        if not re.fullmatch(r'[a-zA-Z0-9_-]{8,64}', args.value): raise ValueError('Invalid deployment identifier.')
        data = {'mode': args.mode, 'deployment_uuid': args.value}
    command = 'docker exec -i coolify php -r ' + shlex.quote(PHP)
    result = subprocess.run(['ssh', '-i', IDENTITY, '-o', 'BatchMode=yes', REMOTE, command], input=json.dumps(data).encode(), capture_output=True)
    if result.returncode: raise RuntimeError('Own Coolify deployment operation failed; provider output was not printed.')
    report = json.loads(result.stdout)
    if report.get('application') != 'qpf9uvw5p9hky4sn5vamun36': raise ValueError('Unexpected deployment target.')
    if args.mode == 'queue' and not report.get('deployment'):
        # Preserve the identifier after an uncertain result; never queue again blindly.
        report['requestedDeployment'] = data['deployment_uuid']
    print(json.dumps(report))

if __name__ == '__main__': main()
