"""Capture canonical public pages only (GET), encrypted, resumable, no form actions."""
import hashlib
import json
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import http.client
from datetime import datetime, timezone
from html.parser import HTMLParser
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from keychain import snapshot_key
from inventory import encrypted_write, decrypt_manifest

DEST = pathlib.Path.home() / 'Programo/underwater-private/20261008-public'
HOSTS = {'underwater.pl', 'www.underwater.pl'}
MAX = 8 * 1024 * 1024

class SourceRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        if not allowed(new_url): raise PermissionError('Source redirect left public read-only scope.')
        return super().redirect_request(request, file, code, message, headers, new_url)

def public_url_scope(url):
    try:
        value = urllib.parse.urlsplit(url)
        return value.scheme == 'https' and value.hostname in HOSTS and value.port in (None,443) and not value.query and not value.username and not value.password and not re.search(r'(?:administrator|checkout|cart|koszyk|logout|unsubscribe|wyloguj|platnosc)',urllib.parse.unquote(value.path),re.I)
    except ValueError:
        return False

def allowed(url):
    return public_url_scope(url) and not calendar_navigation(url)

def calendar_navigation(url):
    # Day/month/year navigation forms an unbounded calendar graph. Capture the
    # current public calendar and its event details; historical completeness
    # still requires the source database export.
    path=urllib.parse.unquote(urllib.parse.urlsplit(url).path).lower()
    if path.startswith('/component/jevents/'):
        return True
    # Only concrete event-detail routes were verified on this source.
    return path.startswith('/kalendarz/') and not re.fullmatch(r'/kalendarz/eventdetail/\d+/-/[^/]+\.html',path)

def get(url):
    if not allowed(url): raise PermissionError('URL outside public capture scope.')
    opener = urllib.request.build_opener(SourceRedirects)
    request = urllib.request.Request(url, headers={'User-Agent': 'Underwater authorized migration snapshot / Programo', 'Accept': 'text/html,application/xml;q=0.9'})
    with opener.open(request, timeout=30) as response:
        body = response.read(MAX+1)
        if len(body) > MAX: raise ValueError('Public page exceeds capture limit.')
        return body, response.geturl(), response.headers.get_content_charset() or 'utf-8'

class SourceLinks(HTMLParser):
    def __init__(self):
        super().__init__(); self.links=[]; self.in_loc=False
    def handle_starttag(self,tag,attrs):
        if tag=='a':
            href=dict(attrs).get('href')
            if href: self.links.append(href)
        if tag=='loc': self.in_loc=True
    def handle_endtag(self,tag):
        if tag=='loc': self.in_loc=False
    def handle_data(self,data):
        if self.in_loc and data.strip(): self.links.append(data.strip())

def source_links(body,final,charset):
    parser=SourceLinks(); parser.feed(body.decode(charset,errors='replace'))
    for href in parser.links:
        link=urllib.parse.urljoin(final,href); parts=urllib.parse.urlsplit(link)
        scheme='https' if parts.scheme=='http' and parts.hostname in HOSTS else parts.scheme
        link=urllib.parse.urlunsplit((scheme,parts.netloc,parts.path,parts.query,''))
        if allowed(link) and parts.path.endswith('.html'): yield link

def capture_priority(url):
    # Resolve the agreed content sections before catalog manufacturer aliases.
    # Every request still passes the same read-only public URL policy.
    path=urllib.parse.urlsplit(url).path.lower()
    first=path.strip('/').split('/')[0]
    content=first.startswith(('galeri','kursy','wypraw','relacj','aktualn','kalendarz','kontakt','centrum','regul','polity','serwis'))
    return (0 if content else 1, url)

def discover():
    result={'https://www.underwater.pl/'}
    candidates=['https://www.underwater.pl/sitemap.xml','https://www.underwater.pl/mapa-strony.html','https://www.underwater.pl/index.php']
    for url in candidates:
        try:
            body,final,charset=get(url)
            result.update(source_links(body,final,charset))
        except (urllib.error.HTTPError,urllib.error.URLError,PermissionError): pass
        time.sleep(1)
    return sorted(result)

def main():
    key = snapshot_key(); DEST.mkdir(parents=True, exist_ok=True, mode=0o700); os.chmod(DEST, 0o700)
    target = DEST/'pages-manifest.enc'
    state = decrypt_manifest(target, key) if target.exists() else {'started_at': datetime.now(timezone.utc).isoformat(), 'source_type': 'public-GET', 'database_snapshot': False, 'files': [], 'pending': discover()}
    if len(state['pending']) + len(state['files']) < 2: raise RuntimeError('No useful public page map discovered.')
    objects = DEST/'objects'; objects.mkdir(exist_ok=True, mode=0o700)
    failures = [row['url'] for row in state.get('failed',[])]
    excluded=[url for url in state['pending'] if calendar_navigation(url)]
    state['excludedNavigation']=sorted(set(state.get('excludedNavigation',[])+excluded))
    state['pending']=[url for url in state['pending'] if not calendar_navigation(url)]
    while state['pending']:
        state['pending'].sort(key=capture_priority)
        url = state['pending'].pop(0)
        try:
            body, final, charset = get(url)
            digest = hashlib.sha256(body).hexdigest(); nonce = os.urandom(12)
            name = hashlib.sha256(url.encode()).hexdigest()+'.enc'
            blob = b'UWENC1'+nonce+AESGCM(key).encrypt(nonce, body, url.encode())
            (objects/name).write_bytes(blob); os.chmod(objects/name, 0o600)
            state['files'].append({'url': url, 'final_url': final, 'object': name, 'bytes': len(body), 'sha256': digest, 'charset': charset})
            # Discover additional canonical links in successful public pages. Every
            # new URL is deduplicated and filtered before it can issue a request.
            seen = {row['url'] for row in state['files']} | set(state['pending']) | set(failures)
            for link in source_links(body,final,charset):
                if link not in seen:
                    if len(seen) >= 20_000:
                        state['captureLimitReached']=True
                        sample=state.setdefault('excludedLimitSample',[])
                        if len(sample)<100 and link not in sample: sample.append(link)
                        continue
                    state['pending'].append(link); seen.add(link)
        except (urllib.error.HTTPError, urllib.error.URLError, OSError, PermissionError, ValueError, LookupError, http.client.HTTPException) as error:
            failures.append(url); state.setdefault('failed', []).append({'url': url, 'error_type': type(error).__name__})
        encrypted_write(target,state,key)
        if len(state['files']) % 25 == 0: print(json.dumps({'public_pages':len(state['files']),'pending':len(state['pending']),'failures':len(state.get('failed',[]))}),flush=True)
        time.sleep(0.7)
    state['finished_at']=datetime.now(timezone.utc).isoformat(); state['complete_public_capture']=not state.get('failed') and not state.get('captureLimitReached'); encrypted_write(target,state,key)
    print(json.dumps({'public_pages':len(state['files']),'complete_public_capture':state['complete_public_capture'],'database_snapshot':False}),flush=True)

if __name__=='__main__':
    try: main()
    except Exception as error: print(json.dumps({'complete_public_capture':False,'error_type':type(error).__name__}),flush=True); raise SystemExit(1)
