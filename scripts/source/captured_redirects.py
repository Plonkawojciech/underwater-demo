"""Preserve verified public HTTP redirect targets without guessing routes."""
import hashlib
from collections import defaultdict
from urllib.parse import urlsplit
from content_parser import FIXED_ROUTES, route_key, safe_page_path
from public_capture import public_url_scope

APP_ROUTES = frozenset({'koszyk', 'newsletter', 'zgloszenie', 'platnosc-testowa', 'api', 'admin', 'media', '_next'})


def attach_captured_redirects(bundle, captures):
    live = set(FIXED_ROUTES) | {''}
    redirects = {}
    for entity in bundle['entities']:
        data = entity['data']
        if entity['collection'] == 'redirects':
            redirects[route_key(data['from'])] = data['to']
            continue
        for field in ['path', 'legacyPath']:
            if data.get(field): live.add(route_key(data[field]))
        if entity['collection'] in {'categories', 'products'} and data.get('slug'):
            live.add(route_key('/' + data['slug'] + '.html'))
        if entity['collection'] == 'courses' and data.get('slug'):
            live.add(route_key('/kursy-nurkowania/' + data['slug'] + '.html'))
    candidates = defaultdict(set)
    issues = []
    for capture in captures:
        original, final = capture['url'], capture.get('final_url') or capture['url']
        if original == final: continue
        if not public_url_scope(original) or not public_url_scope(final):
            raise ValueError('Captured redirect left verified public URL scope.')
        source, target = safe_page_path(urlsplit(original).path), safe_page_path(urlsplit(final).path)
        if source is None or target is None:
            issues.append({'code': 'source-http-redirect-path-review', 'url': original, 'key': None, 'detail': 'path is outside the importer route contract'})
            continue
        if route_key(source) == route_key(target): continue
        candidates[source].add(target)
    def destination(path):
        seen = set()
        for _ in range(20):
            key = route_key(path)
            if key in seen: return None
            if key in live: return path
            seen.add(key)
            path = redirects.get(key)
            if not path: return None
        return None
    for source, targets in sorted(candidates.items()):
        code = None
        if len(targets) != 1: code = 'source-http-redirect-conflict'
        else:
            target = destination(next(iter(targets)))
            if not target: code = 'source-http-redirect-target-unresolved'
            elif route_key(target) in {'', 'index', 'index.php'}: code = 'source-http-redirect-home-review'
            elif route_key(source) in {'index', 'index.php'} or route_key(source).split('/')[0] in APP_ROUTES: code = 'source-http-redirect-app-route'
            elif route_key(source) in live: code = 'source-http-redirect-shadowed'
            elif route_key(source) in redirects:
                if destination(redirects[route_key(source)]) != target: code = 'source-http-redirect-conflict'
                else: continue
            else:
                key = 'public-http-redirect:' + hashlib.sha256(source.encode()).hexdigest()
                bundle['entities'].append({'collection': 'redirects', 'key': key, 'data': {
                    'from': source, 'to': target, 'published': True,
                    'reason': 'Potwierdzony publiczny cel przekierowania witryny źródłowej; utrwalony w podglądzie.',
                }})
                redirects[route_key(source)] = target
        if code: issues.append({'code': code, 'url': source, 'key': None, 'detail': 'verified source HTTP redirect requires reconciliation; no existing content was hidden'})
    return issues
