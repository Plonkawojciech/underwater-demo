"""Verify encrypted public captures, convert content and acquire own-site images.

Only public GETs; no database access, forms or source executable code. Output is
private import staging, not a claim of completeness of the client database.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import time
from collections import Counter

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from content_parser import convert_pages
from bundle_media import attach_media
from captured_redirects import attach_captured_redirects
from public_media_fetch import prefetch
from inventory import decrypt_manifest, encrypted_write
from keychain import snapshot_key
from public_capture import get, allowed, public_url_scope, calendar_navigation

PRIVATE = Path.home() / 'Programo/underwater-private'


def private_json(path, value):
    part = path.with_suffix(path.suffix + '.part')
    part.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True), encoding='utf-8')
    os.chmod(part, 0o600)
    part.replace(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--capture', choices=['priority', 'public'], required=True)
    args = parser.parse_args()
    capture = PRIVATE / ('20261008-' + args.capture)
    manifest_path = capture / 'pages-manifest.enc'
    key = snapshot_key()
    manifest_bytes = manifest_path.read_bytes()
    if manifest_bytes[:6] != b'UWENC1': raise ValueError('Unrecognized public capture manifest.')
    state = json.loads(AESGCM(key).decrypt(manifest_bytes[6:18], manifest_bytes[18:], b'underwater-source-manifest'))
    pages = []
    redirects = 0
    decode_failures = []
    excluded_navigation = []
    for row in state['files']:
        # Object identifiers are local SHA-256 names, never paths from the source.
        if not row['object'].endswith('.enc') or len(row['object']) != 68 or any(c not in '0123456789abcdef' for c in row['object'][:-4]):
            raise ValueError('Invalid encrypted page object identifier.')
        blob = (capture / 'objects' / row['object']).read_bytes()
        if blob[:6] != b'UWENC1':
            raise ValueError('Unrecognized encrypted page.')
        body = AESGCM(key).decrypt(blob[6:18], blob[18:], row['url'].encode())
        if len(body) != row['bytes'] or hashlib.sha256(body).hexdigest() != row['sha256']:
            raise ValueError('Public capture integrity check failed.')
        final = row.get('final_url') or row['url']
        if not public_url_scope(final):
            raise ValueError('Captured page left the authorized public scope.')
        if calendar_navigation(final):
            excluded_navigation.append(final)
            continue  # preserve previously captured views; don't import navigation as content
        redirects += final != row['url']
        try:
            markup = body.decode(row.get('charset') or 'utf-8')
        except (UnicodeError, LookupError) as error:
            decode_failures.append({'url': final, 'error_type': type(error).__name__})
            continue  # encrypted original stays intact for a source-data review
        pages.append({'url': final, 'html': markup, 'sha256': row['sha256'], 'charset': row.get('charset') or 'utf-8'})
    converted = convert_pages(pages, state['started_at'], hashlib.sha256(manifest_bytes).hexdigest())
    converted['unresolved'].extend(attach_captured_redirects(converted['bundle'], state['files']))
    converted['counts']['entities'] = dict(Counter(row['collection'] for row in converted['bundle']['entities']))
    converted['counts']['unresolved'] = len(converted['unresolved'])
    output = PRIVATE / ('20261008-import-' + args.capture)
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(output, 0o700)
    media_root = output / 'media'
    media_root.mkdir(exist_ok=True, mode=0o700)
    archive = output / 'media-encrypted'
    archive.mkdir(exist_ok=True, mode=0o700)
    media_manifest = output / 'media-manifest.enc'
    acquired = decrypt_manifest(media_manifest, key) if media_manifest.exists() else {'files': [], 'failed': []}
    by_key = {row['key']: row for row in acquired['files']}
    bundle = converted['bundle']
    bundle['mediaUrls'] = [
        {'key': row['key'], 'url': url}
        for row in converted['media_urls']
        for url in [row['url'], *row.get('alternateUrls', [])]
    ]
    private_json(output / 'conversion-review-before-media.json', {
        'counts': converted['counts'], 'unresolved': converted['unresolved'],
        'capturePending': len(state.get('pending', [])), 'captureFailures': len(state.get('failed', [])),
        'mediaRequired': len(converted['media_urls']), 'decodeFailures': decode_failures, 'excludedNavigation': excluded_navigation, 'databaseSnapshot': False,
    })
    def cached(row):
        relative = Path(row['path'])
        if relative.is_absolute() or any(p in {'', '.', '..'} or p.startswith('.') for p in relative.parts):
            raise ValueError('Unsafe public media path.')
        previous = by_key.get(row['key'])
        target = media_root / relative
        if not target.resolve().is_relative_to(media_root.resolve()):
            raise ValueError('Media staging path escaped.')
        if previous and target.exists() and not target.is_symlink() and hashlib.sha256(target.read_bytes()).hexdigest() == previous['sha256']:
            return previous
        return None
    for index, row, previous, body, download_error in prefetch(converted['media_urls'], cached):
        relative = Path(row['path'])
        if relative.is_absolute() or any(p in {'', '.', '..'} or p.startswith('.') for p in relative.parts):
            raise ValueError('Unsafe public media path.')
        target = media_root / relative
        if not target.resolve().is_relative_to(media_root.resolve()):
            raise ValueError('Media staging path escaped.')
        if previous:
            descriptor = {**previous, 'alt': row['alt']}
        else:
            try:
                if download_error: raise download_error
                if body is None: raise ValueError('Public image download returned no bytes.')
                descriptor = {'key': row['key'], 'path': row['path'], 'sha256': hashlib.sha256(body).hexdigest(), 'alt': row['alt'], 'url': row['url']}
                nonce = os.urandom(12)
                # Each source version gets its own immutable encrypted object.
                encrypted = archive / (hashlib.sha256((row['url'] + '\0' + descriptor['sha256']).encode()).hexdigest() + '.enc')
                if encrypted.exists():
                    old_blob = encrypted.read_bytes()
                    if old_blob[:6] != b'UWENC1' or AESGCM(key).decrypt(old_blob[6:18], old_blob[18:], row['url'].encode()) != body:
                        raise ValueError('Existing encrypted media object was preserved for review.')
                else:
                    fd = os.open(encrypted, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                    with os.fdopen(fd, 'wb') as stream:
                        stream.write(b'UWENC1' + nonce + AESGCM(key).encrypt(nonce, body, row['url'].encode()))
                        stream.flush(); os.fsync(stream.fileno())
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                if target.exists() and target.is_symlink():
                    raise ValueError('Existing staging symlink was preserved.')
                if target.exists():
                    target.rename(target.with_name(target.name + '.previous-' + str(time.time_ns())))
                target.write_bytes(body)
                os.chmod(target, 0o600)
                acquired['files'] = [item for item in acquired['files'] if item['key'] != row['key']] + [descriptor]
                by_key[row['key']] = descriptor
                acquired['failed'] = [item for item in acquired['failed'] if item['key'] != row['key']]
                encrypted_write(media_manifest, acquired, key)
            except Exception as error:
                acquired['failed'] = [item for item in acquired['failed'] if item['key'] != row['key']] + [{'key': row['key'], 'error_type': type(error).__name__}]
                encrypted_write(media_manifest, acquired, key)
                continue
        bundle['media'].append(descriptor)
        if index % 50 == 0:
            print(json.dumps({'media_processed': index + 1, 'media_ready': len(bundle['media']), 'failures': len(acquired['failed'])}), flush=True)
    attach_media(bundle, converted['media_urls'])
    private_json(output / 'bundle.json', bundle)
    private_json(output / 'conversion-report.json', {'counts': converted['counts'], 'unresolved': converted['unresolved'], 'capturePending': len(state.get('pending', [])), 'captureFailures': len(state.get('failed', [])), 'sourceRedirects': redirects, 'mediaFailures': acquired['failed'], 'decodeFailures': decode_failures, 'excludedNavigation': excluded_navigation, 'databaseSnapshot': False})
    print(json.dumps({'entities': dict(Counter(row['collection'] for row in bundle['entities'])), 'media': len(bundle['media']), 'conversionReview': dict(Counter(row['code'] for row in converted['unresolved'])), 'mediaFailures': len(acquired['failed']), 'sourceComplete': False}), flush=True)


if __name__ == '__main__':
    main()
