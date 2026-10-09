"""Attach only verified, inventoried public PDFs to private import staging."""
import hashlib
import os
from pathlib import Path
from inventory import decrypt_manifest


def attach_documents(bundle, private, media_root, key):
    source = private / '20261008-public-documents'
    manifest_path = source / 'documents-manifest.enc'
    if not manifest_path.exists():
        return {'ready': 0, 'failed': 0}
    state = decrypt_manifest(manifest_path, key)
    descriptors = []
    output = media_root / 'documents'
    output.mkdir(mode=0o700, exist_ok=True)
    for row in state['files']:
        digest = row['sha256']
        if len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest) or row['path'] != digest + '.pdf':
            raise ValueError('Invalid PDF checkpoint descriptor.')
        original = source / 'files' / row['path']
        if original.is_symlink() or not original.is_file() or original.stat().st_size > 8 * 1024 * 1024:
            raise ValueError('Invalid PDF checkpoint file.')
        body = original.read_bytes()
        if hashlib.sha256(body).hexdigest() != digest or len(body) != row['bytes']:
            raise ValueError('PDF checkpoint integrity failed.')
        target = output / row['path']
        if target.exists():
            if target.is_symlink() or hashlib.sha256(target.read_bytes()).hexdigest() != digest:
                raise ValueError('Existing PDF staging preserved for review.')
        else:
            with target.open('xb') as stream:
                stream.write(body); stream.flush(); os.fsync(stream.fileno())
            os.chmod(target, 0o600)
        descriptors.append({name: row[name] for name in ['key', 'sha256', 'title', 'url']} | {'path': 'documents/' + row['path']})
    bundle['documents'] = sorted(descriptors, key=lambda row: row['key'])
    return {'ready': len(descriptors), 'failed': len(state.get('failed', []))}
