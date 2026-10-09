"""Read every captured public content route on our isolated preview only.

No client host/database, CMS login, private record read or write. Basic preview
access stays in memory; redirects cannot carry it outside the one own origin.
"""
import argparse
import base64
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'source'))
from keychain import read_secret, security

ORIGIN = 'https://underwater-demo.programo.pl'
PRIVATE = Path.home() / 'Programo/underwater-private'
BLOCKED = {'api', 'admin', '_next', 'newsletter', 'platnosc-testowa', 'zgloszenie', 'koszyk', 'media'}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): return None


def own_path(value):
    if not isinstance(value, str) or not value.startswith('/') or value.startswith('//') or '\\' in value or any(ord(c) < 32 for c in value):
        raise ValueError('Unsupported own public route.')
    parts = urllib.parse.urlsplit(value)
    if parts.scheme or parts.netloc or parts.fragment or parts.query:
        raise ValueError('Expected a captured public path without credentials or query.')
    decoded = urllib.parse.unquote(parts.path)
    if decoded.split('/')[1].lower() in BLOCKED or any(part in {'.', '..'} for part in decoded.split('/')):
        raise ValueError('Private/application routes are outside coverage scope.')
    return urllib.parse.quote(parts.path, safe='/%:@!$&\'()*+,;=-._~')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('bundle', type=Path)
    parser.add_argument('report', type=Path)
    args = parser.parse_args()
    for item in (args.bundle, args.report):
        if not item.resolve().is_relative_to(PRIVATE.resolve()) or any(part.startswith('.env') for part in item.parts):
            raise ValueError('Only private own source staging and proof destinations are allowed.')
    if args.report.exists() or args.report.is_symlink(): raise FileExistsError('Preserve previous proof.')
    bundle = json.loads(args.bundle.read_text())
    paths = {}
    skipped = Counter()
    for row in bundle['entities']:
        kind, data = row['collection'], row['data']
        if kind == 'course-sessions' or not data.get('published', True): continue
        path = data.get('from') if kind == 'redirects' else data.get('legacyPath') or data.get('path')
        if not path: skipped[kind] += 1; continue
        try: path = own_path(path)
        except ValueError: skipped[kind] += 1; continue
        paths.setdefault(path, set()).add(kind)
    if not paths or len(paths) > 10_000: raise ValueError('Unexpected coverage size.')
    security().SecKeychainSetUserInteractionAllowed(False)
    password = read_secret('programo.underwater.preview.basic-password')
    if not password: raise PermissionError('Approved own-preview credential unavailable.')
    authorization = 'Basic ' + base64.b64encode(b'wojtek-underwater:' + password).decode()
    del password

    def verify(path):
        opener = urllib.request.build_opener(NoRedirect())
        initial, hops = path, 0
        try:
            while True:
                req = urllib.request.Request(ORIGIN + path, headers={'Authorization': authorization, 'User-Agent': 'Programo-Underwater-own-route-coverage/1.0'})
                try: response = opener.open(req, timeout=25)
                except urllib.error.HTTPError as error: response = error
                with response:
                    status, headers = response.status, response.headers
                    body = response.read(2 * 1024 * 1024 + 1)
                if len(body) > 2 * 1024 * 1024: raise ValueError('Own HTML response too large.')
                if status in {301, 302, 307, 308}:
                    if hops >= 5: raise ValueError('Own route redirect chain exceeded bound.')
                    target = urllib.parse.urlsplit(urllib.parse.urljoin(ORIGIN + path, headers.get('Location', '')))
                    if target.scheme != 'https' or target.netloc != 'underwater-demo.programo.pl':
                        raise ValueError('Redirect left the own origin; credential was not forwarded.')
                    path = own_path(target.path); hops += 1; continue
                ok = status == 200 and 'text/html' in headers.get('Content-Type', '') and 'noindex' in headers.get('X-Robots-Tag', '') and 'no-store' in headers.get('Cache-Control', '')
                return {'path': initial, 'status': status, 'redirects': hops, 'ok': ok, 'sha256': hashlib.sha256(body).hexdigest()}
        except Exception as error:
            return {'path': initial, 'ok': False, 'errorType': type(error).__name__}

    results = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        for result in pool.map(verify, paths):
            results.append(result)
            if len(results) % 100 == 0:
                print(json.dumps({'checked': len(results), 'expected': len(paths), 'failed': sum(not row['ok'] for row in results)}), flush=True)
    failures = [row for row in results if not row['ok']]
    report = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'origin': ORIGIN, 'expected': len(paths), 'checked': len(results), 'passed': len(results) - len(failures), 'failed': failures, 'skippedWithoutPublicRoute': dict(skipped), 'results': results, 'clientWrites': False, 'sourceDatabaseAccess': False, 'cmsLogin': False}
    with args.report.open('x', encoding='utf8') as stream:
        os.chmod(args.report, 0o600); json.dump(report, stream, ensure_ascii=False, indent=2)
    print(json.dumps({**report, 'results': None, 'failed': len(failures)}))
    if failures: raise SystemExit(1)


if __name__ == '__main__': main()
