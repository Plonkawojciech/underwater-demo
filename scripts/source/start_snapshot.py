"""Send only Keychain values through SSH stdin; no secrets in files/argv/logs."""
import base64
import argparse
import json
import pathlib
import subprocess
from keychain import read_secret, FTP_SERVICE, snapshot_key
from inventory import DESTINATION

REMOTE = 'root@159.195.206.7'
IDENTITY = str(pathlib.Path.home() / '.ssh/netcup_rs2000')
ROOT = pathlib.Path(__file__).parent

def main():
    args = argparse.ArgumentParser()
    args.add_argument('--partial', action='store_true', help='Copy the current encrypted inventory checkpoint; never report a complete snapshot.')
    args.add_argument('--connections', type=int, default=4, choices=range(1, 5), help='Independent read-only FTPS connections on the VM (1..4).')
    options = args.parse_args()
    manifest = DESTINATION / 'inventory.enc'
    if not manifest.exists() and options.partial: manifest = DESTINATION / 'inventory-progress.enc'
    if not manifest.exists(): raise FileNotFoundError('Read-only inventory is not available.')
    subprocess.run(['ssh', '-i', IDENTITY, '-o', 'BatchMode=yes', REMOTE, 'mkdir -p /root/underwater/source/20261008 && chmod 700 /root/underwater/source /root/underwater/source/20261008'], check=True)
    subprocess.run(['scp', '-i', IDENTITY, str(ROOT / 'snapshot_worker.py'), str(ROOT / 'ftp_readonly.py'), REMOTE + ':/root/underwater/source/20261008/'], check=True)
    subprocess.run(['scp', '-i', IDENTITY, str(manifest), REMOTE + ':/root/underwater/source/20261008/inventory.enc'], check=True)
    credential = read_secret(FTP_SERVICE)
    if credential is None: raise PermissionError('FTPS credential missing from Keychain.')
    # Only the connection count travels in argv; key and password go through stdin.
    # The worker holds snapshot.lock, so a second parallel worker refuses to start.
    remote = 'cd /root/underwater/source/20261008 && python3 snapshot_worker.py --connections %d' % options.connections
    process = subprocess.Popen(['ssh', '-i', IDENTITY, '-o', 'BatchMode=yes', REMOTE, remote], stdin=subprocess.PIPE)
    process.stdin.write(json.dumps({'key': base64.b64encode(snapshot_key()).decode(), 'password': base64.b64encode(credential).decode()}).encode() + b'\n'); process.stdin.close()
    del credential
    raise SystemExit(process.wait())

if __name__ == '__main__': main()
