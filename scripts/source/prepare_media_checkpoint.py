"""Freeze verified public images for an additive early media-only import.

Acquisition continues independently. This does not import content, settings or
assert source completeness. The final public bundle reuses media by legacy key.
"""
import hashlib
import json
import os
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from keychain import snapshot_key
from inventory import AAD

PRIVATE = Path.home() / 'Programo/underwater-private'


def prepare(root=PRIVATE, key=None):
    key = key or snapshot_key()
    source = root / '20261008-import-public'
    manifest_bytes = (source / 'media-manifest.enc').read_bytes()
    if manifest_bytes[:6] != b'UWENC1': raise ValueError('Invalid encrypted media checkpoint.')
    manifest = json.loads(AESGCM(key).decrypt(manifest_bytes[6:18], manifest_bytes[18:], AAD))
    capture_bytes = (root / '20261008-public/pages-manifest.enc').read_bytes()
    if capture_bytes[:6] != b'UWENC1': raise ValueError('Invalid encrypted public capture.')
    capture = json.loads(AESGCM(key).decrypt(capture_bytes[6:18], capture_bytes[18:], AAD))
    media_root = (source / 'media').resolve(strict=True)
    rows, keys, paths = [], set(), set()
    for row in manifest['files']:
        relative = Path(row['path'])
        if relative.is_absolute() or not relative.parts or any(part in {'.', '..'} or part.startswith('.') or '\n' in part or '\r' in part for part in relative.parts): raise ValueError('Unsafe public media path.')
        target = media_root / relative
        if target.is_symlink() or not target.resolve(strict=True).is_relative_to(media_root): raise ValueError('Public media escaped staging.')
        if not target.is_file() or target.stat().st_size > 12 * 1024 * 1024: raise ValueError('Invalid public media file.')
        if hashlib.sha256(target.read_bytes()).hexdigest() != row['sha256']: raise ValueError('Public media changed since its authenticated checkpoint.')
        if row['key'] in keys or row['path'] in paths: raise ValueError('Duplicate public media checkpoint key/path.')
        keys.add(row['key']); paths.add(row['path'])
        rows.append({name: row[name] for name in ['key', 'path', 'sha256', 'url', 'alt'] if name in row})
    output = root / '20261008-import-public-media'
    output.mkdir(mode=0o700, exist_ok=True)
    os.chmod(output, 0o700)
    bundle = {'version': 1, 'source': {'kind': 'public-pages', 'manifestHash': hashlib.sha256(manifest_bytes).hexdigest(), 'capturedAt': capture['started_at'], 'complete': False}, 'media': rows, 'entities': []}
    for name, contents in [('bundle.json', json.dumps(bundle, ensure_ascii=False)), ('files.txt', ''.join(row['path'] + '\n' for row in rows))]:
        target = output / name
        if target.exists(): raise FileExistsError('An existing frozen checkpoint was preserved.')
        with target.open('x', encoding='utf-8') as stream: stream.write(contents)
        os.chmod(target, 0o600)
    return {'media': len(rows), 'contentEntities': 0, 'sourceComplete': False, 'checkpointHash': bundle['source']['manifestHash'], 'output': str(output)}


if __name__ == '__main__': print(json.dumps(prepare()))
