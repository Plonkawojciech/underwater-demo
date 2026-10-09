"""Verify encrypted public captures, convert content and acquire own-site images.

Only public GETs; no database access, forms or source executable code. Output is
private import staging, not a claim of completeness of the client database.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
from collections import Counter
from urllib.parse import urlsplit

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from content_parser import convert_pages
from bundle_media import attach_media
from captured_redirects import attach_captured_redirects
from captured_home_aliases import attach_verified_home_aliases
from media_cache import acquire
from public_document_bundle import attach_documents
from inventory import decrypt_manifest
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
    parser.add_argument('--cached-only', action='store_true', help='Reconvert immutable captures and verified image cache without any source network request.')
    parser.add_argument('--skip-known-failures', action='store_true', help='Acquire only new source URLs; do not retry archived HTTP/auth failures.')
    args = parser.parse_args()
    if args.cached_only and args.skip_known_failures: raise ValueError('Choose a single replay mode.')
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
    # The authenticated manifest rows also resolve listing cards and calendar links that the source
    # answered with an exact HTTP redirect; the redirect records are still attached afterwards.
    converted = convert_pages(pages, state['started_at'], hashlib.sha256(manifest_bytes).hexdigest(), state['files'])
    converted['unresolved'].extend(attach_captured_redirects(converted['bundle'], state['files']))
    verified_home_aliases = attach_verified_home_aliases(converted['bundle'], pages)
    resolved_home_paths = {row['path'] for row in verified_home_aliases}
    for issue in converted['unresolved']:
        if issue['code'] == 'no-main-content' and issue.get('url') and urlsplit(issue['url']).path in resolved_home_paths:
            issue.update(code='source-home-alias-resolved', detail='informational: exact captured homepage main content; a verified redirect to the homepage is included')
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
    # Each key stages to its own images/<sha256(key)> path; cached bytes are restored
    # from verified staging or the authenticated archive, never from a GET.
    bundle['media'].extend(acquire(converted['media_urls'], acquired, media_manifest, media_root, archive, key, cached_only=args.cached_only, skip_known_failures=args.skip_known_failures))
    attach_media(bundle, converted['media_urls'])
    documents = attach_documents(bundle, PRIVATE, media_root, key)
    private_json(output / 'bundle.json', bundle)
    private_json(output / 'conversion-report.json', {'counts': converted['counts'], 'unresolved': converted['unresolved'], 'capturePending': len(state.get('pending', [])), 'captureFailures': len(state.get('failed', [])), 'sourceRedirects': redirects, 'verifiedHomeAliases': verified_home_aliases, 'mediaFailures': acquired['failed'], 'decodeFailures': decode_failures, 'excludedNavigation': excluded_navigation, 'databaseSnapshot': False})
    print(json.dumps({'entities': dict(Counter(row['collection'] for row in bundle['entities'])), 'media': len(bundle['media']), 'documents': documents, 'conversionReview': dict(Counter(row['code'] for row in converted['unresolved'])), 'mediaFailures': len(acquired['failed']), 'sourceComplete': False}), flush=True)


if __name__ == '__main__':
    main()
