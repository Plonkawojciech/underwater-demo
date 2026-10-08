"""Resumable read-only FTPS inventory. Metadata and traversal state are encrypted."""
import hashlib
import json
import os
import pathlib
import posixpath
import socket
import ssl
import time
import ftplib
from datetime import datetime, timezone
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from ftp_readonly import ACCOUNT, EXPECTED_ADDRESS, HOST, ReadOnlyFTP
from keychain import FTP_SERVICE, read_secret, snapshot_key

ROOTS = ['public_html', 'tylkopliki', 'vmfiles']
DESTINATION = pathlib.Path.home() / 'Programo' / 'underwater-private' / '20261008-source'
AAD = b'underwater-source-manifest'

def list_directory(ftp):
    lines = []; ftp.retrlines('LIST', lines.append); entries = []
    for line in lines:
        if line.startswith('total '): continue
        parts = line.split(None, 8)
        if len(parts) != 9 or parts[0][0] not in {'d', '-', 'l'}: raise RuntimeError('Unrecognized FTP listing format.')
        name = parts[8].split(' -> ', 1)[0] if parts[0][0] == 'l' else parts[8]
        if name in {'.', '..'}: continue
        if any(c in name for c in ['/', '\\', '\r', '\n', '\x00']): raise RuntimeError('Unsafe source filename.')
        entries.append({'name': name, 'type': {'d': 'directory', '-': 'file', 'l': 'symlink'}[parts[0][0]], 'size': int(parts[4]), 'source_timestamp': ' '.join(parts[5:8])})
    return entries

def encrypted_write(target, data, key):
    nonce = os.urandom(12)
    cipher = b'UWENC1' + nonce + AESGCM(key).encrypt(nonce, json.dumps(data, ensure_ascii=False, sort_keys=True).encode(), AAD)
    part = target.with_suffix(target.suffix + '.part'); part.write_bytes(cipher); os.chmod(part, 0o600); part.replace(target)
    return hashlib.sha256(cipher).hexdigest()

def decrypt_manifest(path, key):
    blob = path.read_bytes()
    if blob[:6] != b'UWENC1': raise ValueError('Invalid encrypted inventory.')
    return json.loads(AESGCM(key).decrypt(blob[6:18], blob[18:], AAD))

def connect(password):
    if socket.gethostbyname(HOST) != EXPECTED_ADDRESS: raise PermissionError('Authorized source address changed.')
    ftp = ReadOnlyFTP(context=ssl.create_default_context(), timeout=40)
    ftp.connect(HOST, 21); ftp.login(ACCOUNT, password); ftp.prot_p(); return ftp

def main():
    credential = read_secret(FTP_SERVICE)
    if credential is None: raise PermissionError('Source credential missing from Keychain.')
    password = credential.decode(); del credential
    key = snapshot_key()
    DESTINATION.mkdir(parents=True, exist_ok=True, mode=0o700); os.chmod(DESTINATION.parent, 0o700); os.chmod(DESTINATION, 0o700)
    complete = DESTINATION / 'inventory.enc'
    if complete.exists(): raise FileExistsError('A complete inventory already exists and is preserved.')
    progress = DESTINATION / 'inventory-progress.enc'
    state = decrypt_manifest(progress, key) if progress.exists() else {'started_at': datetime.now(timezone.utc).isoformat(), 'roots': ROOTS, 'directories': 0, 'files': [], 'skipped': [], 'queue': list(reversed(ROOTS)), 'mode': 'read-only-metadata', 'database_snapshot': False, 'complete_inventory': False}
    ftp = None
    try:
        while state['queue']:
            remote = state['queue'][-1]
            if remote.split('/')[0] not in ROOTS or '..' in remote.split('/') or remote.count('/') > 40: raise RuntimeError('Source directory outside authorized limits.')
            entries = None
            for attempt in range(5):
                try:
                    if ftp is None: ftp = connect(password)
                    ftp.cwd('/' + remote); entries = list_directory(ftp); break
                except ftplib.error_perm as error:
                    if str(error).startswith('550'):
                        state['skipped'].append({'path':remote,'reason':'inaccessible-directory'}); entries=[]; break
                    raise
                except (OSError, EOFError, ftplib.error_temp) as error:
                    if ftp is not None:
                        try: ftp.close()
                        except Exception: pass
                    ftp = None; encrypted_write(progress, state, key)
                    print(json.dumps({'reconnecting': True, 'attempt': attempt+1, 'directories': state['directories'], 'error_type': type(error).__name__}), flush=True)
                    if attempt == 4: raise
                    time.sleep(min(30, 5 * (attempt+1)))
            state['queue'].pop()
            for entry in entries:
                name = entry.pop('name'); full = posixpath.join(remote, name)
                if name.startswith('.env') or name in {'.bash_history', '.zsh_history'}: state['skipped'].append({'path': full, 'reason': 'secret-environment-or-shell-history'})
                elif entry['type'] == 'directory': state['queue'].append(full)
                elif entry['type'] == 'symlink': state['skipped'].append({'path': full, 'reason': 'symlink-not-followed'})
                else: state['files'].append({'path': full, **entry})
            state['directories'] += 1
            if state['directories'] % 25 == 0:
                encrypted_write(progress, state, key)
                print(json.dumps({'directories': state['directories'], 'files': len(state['files']), 'bytes': sum(r['size'] for r in state['files'])}), flush=True)
            time.sleep(0.25)
        state.pop('queue'); state['finished_at'] = datetime.now(timezone.utc).isoformat(); state['complete_inventory'] = True
        digest = encrypted_write(complete, state, key)
        print(json.dumps({'complete_inventory': True, 'directories': state['directories'], 'files': len(state['files']), 'bytes': sum(r['size'] for r in state['files']), 'skipped': len(state['skipped']), 'encrypted_manifest': str(complete), 'sha256': digest}), flush=True)
    finally:
        if 'queue' in state: encrypted_write(progress,state,key)
        if ftp is not None:
            try: ftp.quit()
            except Exception: ftp.close()
        del password, key

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(json.dumps({'complete_inventory': False, 'error_type': type(error).__name__}), flush=True); raise SystemExit(1)
