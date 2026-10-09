"""Operate only the reviewed image of our isolated preview, without secret argv.
Source credentials/archives never enter the application. Bootstrap secrets use stdin.
"""
import argparse
import json
from pathlib import Path
import re
import shlex
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'source'))
from keychain import read_secret

REMOTE = 'root@159.195.206.7'
IDENTITY = str(Path.home() / '.ssh/netcup_rs2000')
APP = 'qpf9uvw5p9hky4sn5vamun36'
GUARD = r'''
if (process.env.UNDERWATER_ENVIRONMENT !== 'preview' || process.env.UNDERWATER_DATA_ROOT !== '/data/preview' || process.env.DATABASE_URI !== 'file:/data/preview/underwater-preview.db' || process.env.MEDIA_DIR !== '/data/preview/media') throw new Error('Wrong isolated runtime target.');
'''
COUNTS = GUARD + r'''
const { getPayload } = await import('payload');
const { default: config } = await import('./src/payload.config.ts');
const payload = await getPayload({ config, disableOnInit: true });
try {
 const counts = {};
 for (const collection of ['categories','products','courses','course-sessions','pages','trips','albums','events','redirects','media','users','orders','signups','contacts','newsletter','outbox','import-runs']) counts[collection] = (await payload.count({ collection, overrideAccess: true })).totalDocs;
 if (payload.collections.documents) counts.documents = (await payload.count({ collection: 'documents', overrideAccess: true })).totalDocs;
 console.log(JSON.stringify({ environment: 'preview', counts }));
} finally { await payload.destroy(); }
'''
BOOTSTRAP = GUARD + r'''
let input = ''; for await (const chunk of process.stdin) input += chunk;
const supplied = JSON.parse(input); input = '';
if (typeof supplied.password !== 'string' || supplied.password.length < 24) throw new Error('Missing private bootstrap password.');
process.env.UNDERWATER_ADMIN_PASSWORD = supplied.password; supplied.password = '';
if (process.env.UNDERWATER_ADMIN_EMAIL !== 'underwater-preview@programo.pl') throw new Error('Wrong isolated administrator account.');
try { await import('./scripts/database/bootstrap-admin.ts'); }
finally { delete process.env.UNDERWATER_ADMIN_PASSWORD; }
'''
REMOTE_RUN = r'''
import json,subprocess,sys
import re
i=json.load(sys.stdin)
app='qpf9uvw5p9hky4sn5vamun36'
ids=subprocess.check_output(['docker','ps','--filter','name='+app+'-','--format','{{.ID}}'],text=True).split()
matches=[]
for cid in ids:
 d=json.loads(subprocess.check_output(['docker','inspect',cid]))[0]
 if d['Name'].lstrip('/').startswith(app+'-'):matches.append(d)
if len(matches)!=1:raise RuntimeError('Exactly one authorized preview container is required.')
d=matches[0]
if d['Config']['Image']!=app+':'+i['commit']:raise RuntimeError('The running image does not match the reviewed commit.')
mounts=[m for m in d['Mounts'] if m['Destination']=='/data' or m['Destination'].startswith('/data/')]
if len(mounts)!=1 or mounts[0]['Destination']!='/data' or mounts[0].get('Type')!='volume' or mounts[0].get('Name')!=app+'-underwater-data':raise RuntimeError('Wrong isolated preview volume.')
command=['docker','exec','-i',d['Id'],'node','--import','tsx','--input-type=module','-e',i['javascript']]
result=subprocess.run(command,input=json.dumps(i.get('input',{})).encode(),capture_output=True)
if result.returncode:
 # SDK errors can contain input; never forward their traces or supplied secrets.
 stderr=result.stderr.decode(errors='replace')
 kinds=sorted(set(re.findall(r'(?m)^(?:[A-Za-z0-9_.]*\.)?([A-Za-z][A-Za-z0-9]*Error)(?:\s*\[[A-Z_]+\])?:',stderr)))
 fields=[]
 for line in result.stdout.decode(errors='replace').splitlines():
  try:
   diagnostic=json.loads(line)
   if isinstance(diagnostic,dict) and isinstance(diagnostic.get('importValidationFields'),list):fields.extend(value for value in diagnostic['importValidationFields'] if isinstance(value,str) and re.fullmatch(r'[a-zA-Z][a-zA-Z0-9_.\[\]-]{0,159}',value))
  except (ValueError,TypeError):pass
 print(json.dumps({'operation':i['mode'],'success':False,'exitCode':result.returncode,'errorTypes':kinds,'validationFields':sorted(set(fields))[:100]}))
 raise SystemExit(1)
if not result.stdout.strip():
 print(json.dumps({'operation':i['mode'],'success':False,'reason':'Missing operation result; inspect state before any retry.'}))
 raise SystemExit(1)
sys.stdout.buffer.write(result.stdout)
'''

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['bootstrap', 'counts', 'dry-run', 'import'])
    parser.add_argument('commit', help='Exact reviewed and deployed 40-character commit')
    parser.add_argument('--bundle', choices=['priority', 'public', 'public-final', 'public-recovered-final', 'public-fidelity-final'])
    args = parser.parse_args()
    if not re.fullmatch(r'[a-f0-9]{40}', args.commit): raise ValueError('An exact reviewed commit is required.')
    supplied = {}
    if args.mode == 'bootstrap':
        password = read_secret('programo.underwater.preview.admin-password')
        if password is None: raise PermissionError('Private bootstrap credential missing from Keychain.')
        supplied['password'] = password.decode('ascii')
        del password
        javascript = BOOTSTRAP
    elif args.mode == 'counts':
        javascript = COUNTS
    else:
        if not args.bundle: raise ValueError('An explicit authorized staged bundle is required.')
        directory = '/data/preview/staging/' + args.bundle
        argv = ['node', 'import-bundle', directory + '/bundle.json', directory + '/media']
        if args.mode == 'dry-run': argv.append('--dry-run')
        javascript = GUARD + '\nprocess.argv = ' + json.dumps(argv) + ';\nawait import("./scripts/import/import-bundle.ts");'
    data = {'mode': args.mode, 'commit': args.commit, 'javascript': javascript, 'input': supplied}
    result = subprocess.run(['ssh', '-i', IDENTITY, '-o', 'BatchMode=yes', REMOTE, 'python3 -c ' + shlex.quote(REMOTE_RUN)], input=json.dumps(data).encode(), capture_output=True)
    del data, supplied
    if result.returncode:
        # Only our remote guard's sanitized result is eligible for display.
        try:
            report = json.loads(result.stdout)
            if report.get('operation') == args.mode and report.get('success') is False:
                print(json.dumps(report))
        except (ValueError, AttributeError): pass
        raise RuntimeError('Isolated preview runtime operation failed. No credential or SDK trace was printed.')
    print(result.stdout.decode().strip())

if __name__ == '__main__': main()
