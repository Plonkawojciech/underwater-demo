"""Preserve source home aliases proved by equal captured main content.

Inputs are the already authenticated public HTML captures. No network, source
configuration or database access. Existing content always owns its address.
"""
import hashlib
from collections import defaultdict
from urllib.parse import urlsplit
from content_parser import Body, base_of, outermost, parse_html, route_key, safe_page_path, select


def attach_verified_home_aliases(bundle, pages):
    candidates = defaultdict(list)
    for page in pages:
        url = urlsplit(page['url'])
        if url.scheme not in {'http', 'https'} or url.hostname not in {'underwater.pl', 'www.underwater.pl'} or url.username or url.password or url.port or url.query or url.fragment:
            continue
        path = safe_page_path(url.path)
        # This is the source's homepage menu namespace. Other missing pages are
        # never made home aliases even when an error template looks similar.
        if path != '/' and (path is None or not path.startswith('/strona-glowna/')):
            continue
        doc = parse_html(page['html'])
        mains = outermost(select(doc, lambda n: n.has_class('portal-real-content')))
        if len(mains) != 1 or len(select(mains[0], lambda n: n.tag == 'h1')) < 4:
            continue
        rendered = Body(base_of(doc, page['url'])).render(mains[0])
        if len(rendered.encode()) < 200:
            continue
        candidates[path].append(hashlib.sha256(rendered.encode()).hexdigest())
    home = set(candidates.pop('/', []))
    if len(home) != 1:
        return []  # missing or conflicting captured homepage; no inference
    live = set()
    for entity in bundle['entities']:
        data = entity['data']
        for name in ['path', 'legacyPath', 'from']:
            if data.get(name):
                live.add(route_key(data[name]))
        if entity['collection'] in {'categories', 'products'}:
            live.add(data['slug'])
        elif entity['collection'] == 'courses':
            live.add('kursy-nurkowania/' + data['slug'])
    verified = []
    for path, fingerprints in sorted(candidates.items()):
        if set(fingerprints) != home or route_key(path) in live:
            continue
        bundle['entities'].append({'collection': 'redirects', 'key': 'public-home-alias:' + hashlib.sha256(path.encode()).hexdigest(), 'data': {
            'from': path, 'to': '/', 'published': True,
            'reason': 'Treść główna utrwalonego adresu źródłowego jest identyczna ze stroną główną.',
        }})
        live.add(route_key(path))
        verified.append({'path': path, 'mainSha256': next(iter(home))})
    return verified
