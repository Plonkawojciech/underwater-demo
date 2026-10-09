#!/usr/bin/env python3
"""Convert captured public Underwater pages (Joomla/VirtueMart HTML) into a v1 import bundle.

Pure standard library and a pure function: no network, decryption or source
access. The coordinator passes already decrypted page records
{url, html, sha256, charset?} and receives {bundle, media_urls, unresolved, counts}.
A public capture is not a database snapshot, so source.complete is always False.
Values that the public HTML does not show (stock, tax, dates, fees, course
structure) are never derived; anything ambiguous is reported, not guessed.
"""
from __future__ import annotations

import argparse
import hashlib
import html as html_lib
import json
import os
import re
import sys
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qsl, quote, unquote, urljoin, urlsplit, urlunsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

HOSTS = frozenset({'underwater.pl', 'www.underwater.pl'})
MAX_PAGES = 20_000
MAX_HTML = 8 * 1024 * 1024
MAX_DEPTH = 400
# Section routes the application renders itself (src/views/resolve.ts FIXED). A source page at one
# of these paths is not shadowed: the section reads its title, SEO and body from the pages record.
FIXED_ROUTES = frozenset({
    'sklep-nurkowy', 'kursy-nurkowania', 'kursy-nurkowania/kursy-nurkowania-padi-warszawa', 'kontakt', 'wyprawy', 'wyprawy-nurkowe',
    'kalendarz', 'aktualnosci', 'relacje', 'relacje-z-wypraw', 'galerie', 'galeria',
})
SITE_ZONE = 'Europe/Warsaw'  # the dive centre and its course times are in Warsaw
HOME_PATHS = frozenset({'/', '/index.php', '/index.html'})

# ---------------------------------------------------------------- HTML tree

VOID = frozenset('area base br col embed hr img input keygen link meta param source track wbr'.split())
SCOPE = frozenset('td th table caption button html template object marquee applet'.split())
P_CLOSERS = frozenset('address article aside blockquote details dialog div dl fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr main menu nav ol p pre section table ul'.split())
IMPLIED = {
    'li': ({'li'}, {'ul', 'ol'}), 'dt': ({'dt', 'dd'}, {'dl'}), 'dd': ({'dt', 'dd'}, {'dl'}),
    'option': ({'option'}, {'select', 'optgroup', 'datalist'}), 'tr': ({'tr', 'td', 'th'}, {'table', 'thead', 'tbody', 'tfoot'}),
    'td': ({'td', 'th'}, {'tr', 'table'}), 'th': ({'td', 'th'}, {'tr', 'table'}),
}
TEXTLESS = frozenset('script style noscript template svg math iframe object select textarea button head'.split())
BLOCKS = frozenset('p div br li ul ol h1 h2 h3 h4 h5 h6 tr td th table section article blockquote dd dt dl figure figcaption'.split())


class Node:
    __slots__ = ('tag', 'attrs', 'children', 'parent')

    def __init__(self, tag, attrs, parent):
        self.tag, self.attrs, self.children, self.parent = tag, attrs, [], parent

    def get(self, name):
        return self.attrs.get(name)

    @property
    def classes(self):
        return (self.attrs.get('class') or '').split()

    def has_class(self, name):
        return name in self.classes

    def elements(self):
        return [child for child in self.children if isinstance(child, Node)]

    def ancestors(self):
        node = self.parent
        while node is not None:
            yield node
            node = node.parent


class TreeBuilder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node('#document', {}, None)
        self.stack = [self.root]

    def _close(self, targets, barriers):
        for index in range(len(self.stack) - 1, 0, -1):
            tag = self.stack[index].tag
            if tag in targets:
                del self.stack[index:]
                return
            if tag in barriers or tag in SCOPE:
                return

    def _open(self, tag, attrs, push):
        if tag in P_CLOSERS:
            self._close({'p'}, set())
        if tag in IMPLIED:
            self._close(*IMPLIED[tag])
        values = {}
        for name, value in attrs:
            values.setdefault(name, value if value is not None else '')
        parent = self.stack[-1]
        node = Node(tag, values, parent)
        parent.children.append(node)
        # Unclosed formatting tags in old Joomla markup must not exhaust recursion.
        if push and tag not in VOID and len(self.stack) < MAX_DEPTH:
            self.stack.append(node)

    def handle_starttag(self, tag, attrs):
        self._open(tag, attrs, True)

    def handle_startendtag(self, tag, attrs):
        self._open(tag, attrs, False)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            current = self.stack[index].tag
            if current == tag:
                del self.stack[index:]
                return
            if current in SCOPE and tag not in SCOPE:
                return

    def handle_data(self, data):
        children = self.stack[-1].children
        if children and isinstance(children[-1], str):
            children[-1] += data
        else:
            children.append(data)


def parse_html(markup):
    builder = TreeBuilder()
    builder.feed(markup)
    builder.close()
    return builder.root


def select(root, pred, prune=lambda node: False):
    """Descendants matching pred in document order; pruned subtrees are not entered."""
    found, stack = [], list(reversed(root.elements()))
    while stack:
        node = stack.pop()
        if prune(node):
            continue
        if pred(node):
            found.append(node)
        stack.extend(reversed(node.elements()))
    return found


def outermost(nodes):
    chosen = set(map(id, nodes))
    return [node for node in nodes if not any(id(parent) in chosen for parent in node.ancestors())]


def text_of(node, prune=lambda node: False):
    parts = []

    def walk(current):
        for child in current.children:
            if isinstance(child, str):
                parts.append(child)
            elif child.tag not in TEXTLESS and not prune(child):
                block = child.tag in BLOCKS
                if block:
                    parts.append(' ')
                walk(child)
                if block:
                    parts.append(' ')
    walk(node)
    return re.sub(r'\s+', ' ', ''.join(parts)).strip()


# ------------------------------------------------- page chrome and exclusions

CHROME_TAGS = frozenset({'nav', 'footer', 'aside'})
CHROME_CLASS = re.compile(r'^(?:moduletable.*|module|breadcrumbs?|pathway|navbar.*|nav|menu|mainmenu|vmmenu|vmopen|vmclose|footer.*|.*-footer|cookie.*|social.*|.*-social|share.*|.*-share|addthis.*)$', re.I)
CHROME_ID = re.compile(r'^(?:footer.*|nav.*|menu.*|left|right|header)$', re.I)
# 'sidebar-right', 'left-sitebar' (the source template's spelling), 'portal-right-site-bar'; never a
# centre column such as 'center-sitebar' or 'portal-center-site-bar', which holds the main content.
SIDEBAR_NAME = re.compile(r'(?:side|site)[-_]?bar', re.I)
CENTER_NAME = re.compile(r'cent(?:er|re)', re.I)
BODY_TAGS = frozenset('script style noscript template iframe frame frameset object embed applet svg math form input select option optgroup textarea button link meta base canvas audio video source track map area dialog header nav footer aside head title'.split())
BODY_CLASS = re.compile(r'^(?:page-header|article-info.*|article-tools|article-meta|article_separator|createdate|modifydate|createdby|buttonheading|icons|actions|btn-group|tags|pagenav|pager|pagination|print-icon|email-icon|edit-icon|readmore|items-more|vm-product-rating|product-related-products|product-neighbours|ask-a-question|back-to-category|jcomments.*)$', re.I)
RELATED_CLASS = re.compile(r'related|neighbou?rs?|browse|recommend|similar', re.I)


def is_sidebar_name(name):
    return bool(SIDEBAR_NAME.search(name)) and not CENTER_NAME.search(name)


def is_main_column(node):
    """The source template also names its main column by side: course pages put the article in
    div.fr.right-sitebar, whose own children are the title and then the body
    (<h2 class="contentheading">, <div class="article-content">). A real sidebar holds modules instead."""
    children = node.elements()
    if node.has_class('right-sitebar') and node.parent is not None and node.parent.has_class('portal-real-content'):
        # Verified legacy news layout: the sole article holds its own nsp_header;
        # blog listings use the same column. The left column remains excluded.
        if select(node, lambda child: child.has_class('article-content'), prune=lambda child: any(CHROME_CLASS.match(name) for name in child.classes)):
            return True
    titles = [index for index, child in enumerate(children) if child.has_class('contentheading')]
    return bool(titles) and any(child.has_class('article-content') for child in children[titles[0] + 1:])


def is_chrome(node):
    node_id = node.get('id') or ''
    if node.tag in CHROME_TAGS or any(CHROME_CLASS.match(name) for name in node.classes) or CHROME_ID.match(node_id):
        return True
    if any(is_sidebar_name(name) for name in node.classes) or is_sidebar_name(node_id):
        return not (node.tag == 'div' and is_main_column(node))
    return False


def is_body_excluded(node):
    return node.tag in BODY_TAGS or is_chrome(node) or any(BODY_CLASS.match(name) for name in node.classes)


def is_related(node):
    return any(RELATED_CLASS.search(name) for name in node.classes)


# ------------------------------------------------------------------ URLs

CONTROL = re.compile(r'[\x00-\x1f\x7f-\x9f]')  # C0 and C1, as CONTROL in bundle.ts


def has_invisible(value):
    return any(unicodedata.category(char) == 'Cf' for char in value)


def js_len(value):
    """String length as JavaScript counts it (UTF-16 code units); the importer's limits use that."""
    return len(value.encode('utf-16-le')) // 2


def safe_page_path(raw):
    """Decoded NFC site path that bundle.legacyPath() accepts unchanged, or None."""
    if not raw or len(raw) > 2048 or not raw.startswith('/') or raw.startswith('//') or re.search(r'[\\\x00-\x20\x7f-\x9f?#]', raw):
        return None
    # An encoded '/' would turn into a separator once decoded: another address than the source's.
    if re.search(r'%(?:2f|5c|00|3f|23)', raw, re.I):
        return None
    try:
        decoded = unquote(raw, errors='strict')
    except UnicodeDecodeError:
        return None
    decoded = unicodedata.normalize('NFC', decoded)
    segments = decoded.split('/')[1:]
    # The importer decodes legacyPath again: '%', whitespace and separators would change or fail.
    if decoded.startswith('//') or re.search(r'[%?#\\\s]', decoded) or CONTROL.search(decoded) or has_invisible(decoded):
        return None
    if any(part in ('.', '..') or (not part and index < len(segments) - 1) for index, part in enumerate(segments)):
        return None
    return decoded


def route_key(path):
    """bundle.routeKey(): the address as the public resolver sees it ('/x', '/x/' and '/X.HTML' style forms
    of one address collapse), on the NFC path."""
    path = unicodedata.normalize('NFC', path)
    return re.sub(r'\.html\Z', '', re.sub(r'/+\Z', '', re.sub(r'\A/+', '', path)), flags=re.I)


def slug_char(char, first=False):
    return unicodedata.category(char)[0] in 'LMN' or char in ('_~-' if first else '_.~-')


def valid_slug(slug, nested=True):
    """bundle.ts slug: NFC segments /^[\\p{L}\\p{M}\\p{N}_~-][\\p{L}\\p{M}\\p{N}_.~-]*$/u, at most 200
    characters, no invisible characters; a course slug is a single segment."""
    parts = slug.split('/')
    if js_len(slug) > 200 or slug != unicodedata.normalize('NFC', slug) or has_invisible(slug) or (not nested and len(parts) > 1):
        return False
    return all(part and slug_char(part[0], True) and all(slug_char(char) for char in part[1:]) for part in parts)


def site_path(url, base=None):
    """Decoded path of an Underwater URL (absolute or relative to base); None for other hosts or queries."""
    try:
        parts = urlsplit(urljoin(base, url) if base else url)
        port = parts.port
    except ValueError:
        return None
    if not own_url(parts, port) or parts.query:
        return None
    return safe_page_path(parts.path or '/')


def own_url(parts, port):
    return parts.scheme in ('http', 'https') and parts.hostname in HOSTS and '@' not in parts.netloc and port in (None, 80, 443)


def stem_of(path):
    """Slug form: no leading slash, no trailing .html (as normalizeSegments in the app)."""
    return re.sub(r'\.html$', '', path.lstrip('/'), flags=re.I)


MEDIA_EXT = re.compile(r'\.(?:jpe?g|png|webp|gif|avif)$', re.I)
ASSET_PREFIXES = ('templates/', 'media/', 'modules/', 'plugins/', 'components/', 'administrator/', 'cache/', 'libraries/')
# VirtueMart keeps the client's catalogue photos inside its component directory (the full file and resized/
# thumbnails). Only these exact, case-sensitive directories are exempt from the asset prefixes above; the
# first is the one the live shop serves, the second is the stock VirtueMart 1.1 location.
PRODUCT_IMAGE_DIRS = ('components/com_virtuemart_images/shop_image/product/', 'components/com_virtuemart/shop_image/product/')


def media_ref(src, base):
    """Return ({path, url}, None) for an importable source image or (None, reason)."""
    src = (src or '').strip()
    if not src:
        return None, 'media-empty'
    if src.lower().startswith('data:'):
        return None, 'media-inline-data'
    if '\\' in src or CONTROL.search(src) or len(src) > 2048:
        return None, 'media-unsafe'
    try:
        raw = urlsplit(src)
        parts = urlsplit(urljoin(base, src))
        port = parts.port
    except ValueError:
        return None, 'media-unsafe'
    if raw.query or parts.query or '?' in src:
        return None, 'media-query'
    if re.search(r'%(?:2e|2f|5c|00|3f|23)', src, re.I):
        return None, 'media-encoded-separator'
    if any(segment in ('.', '..') for segment in unquote(raw.path).split('/')):
        return None, 'media-traversal'
    if parts.scheme not in ('http', 'https'):
        return None, 'media-scheme'
    if '@' in parts.netloc:
        return None, 'media-userinfo'
    if parts.hostname not in HOSTS:
        return None, 'media-external-host'
    if port not in (None, 80 if parts.scheme == 'http' else 443):
        return None, 'media-port'
    try:
        decoded = unquote(parts.path, errors='strict')
    except UnicodeDecodeError:
        return None, 'media-unsafe'
    segments = decoded.split('/')[1:]
    # '%' would decode a second time in the importer (mediaSourcePath); invisible characters are rejected there.
    if not segments or re.search(r'[\\%]', decoded) or CONTROL.search(decoded) or has_invisible(decoded):
        return None, 'media-unsafe'
    # Covers .env, .git and other hidden files as well as empty or dot segments.
    if any(segment in ('', '.', '..') or segment.startswith('.') for segment in segments):
        return None, 'media-hidden-or-empty-segment'
    if not MEDIA_EXT.search(decoded):
        return None, 'media-extension'
    # Identity is the NFC path, as the importer resolves every image URL: 'szczegół.jpg' written
    # precomposed or decomposed is one file. The download URL keeps the form the page referenced.
    path = unicodedata.normalize('NFC', decoded[1:])
    if js_len(path) > 1024:
        return None, 'media-unsafe'
    if path.lower().startswith(ASSET_PREFIXES) and not path.startswith(PRODUCT_IMAGE_DIRS):
        return None, 'media-template-asset'
    # Same-host HTTP is upgraded.
    return {'path': path, 'url': 'https://' + parts.hostname + quote(decoded, safe="/!$&'()*+,;=:@-._~")}, None


def public_url(src):
    """Reportable form of a rejected URL: no query, fragment or credentials."""
    try:
        parts = urlsplit(src.strip())
        return urlunsplit((parts.scheme, parts.hostname or '', parts.path, '', ''))[:300]
    except ValueError:
        return ''


def media_key(path):
    return 'public-image:' + hashlib.sha256(path.encode('utf-8')).hexdigest()[:40]


def valid_key(value):
    """Mirror of bundle.ts key(): /^[\\p{L}\\p{N}_.:/-]{1,300}$/u without '..' segments."""
    # {1,300} under the /u flag counts code points, not UTF-16 units.
    return (0 < len(value) <= 300 and value == unicodedata.normalize('NFC', value) and all(unicodedata.category(char)[0] in 'LN' or char in '_.:/-' for char in value)
            and not any(part in ('.', '..') for part in value.split('/')))


def entity_key(prefix, value):
    candidate = f'{prefix}:{value}'
    return candidate if valid_key(candidate) else f'{prefix}-sha256:{hashlib.sha256(value.encode("utf-8")).hexdigest()[:40]}'


# ------------------------------------------------------------------ values

PRICE = re.compile(r'(\d{1,3}(?:[ .]\d{3})+|\d+)(?:,(\d{2}))?\s*(?:zł|pln)', re.I)


def parse_pln_cents(text):
    """'1 299,00 zł' -> 129900. Anything not plainly Polish złoty notation returns None."""
    value = re.sub(r'[\s  ]+', ' ', text or '').strip()
    match = PRICE.fullmatch(value)
    if not match:
        return None
    return int(re.sub(r'[ .]', '', match.group(1))) * 100 + int(match.group(2) or 0)


def stable_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode('utf-8')).hexdigest()


class Skip(Exception):
    def __init__(self, code, detail=''):
        super().__init__(code)
        self.code, self.detail = code, detail


class Report:
    def __init__(self):
        self.items, self.skipped = {}, Counter()

    def add(self, code, url=None, key=None, detail=''):
        item = {'code': code, 'url': url, 'key': key, 'detail': str(detail)[:500]}
        self.items[json.dumps(item, sort_keys=True, ensure_ascii=False)] = item

    def skip(self, reason, url, detail='', review=True):
        self.skipped[reason] += 1
        if review:
            self.add(reason, url, None, detail)

    def unresolved(self):
        return sorted(self.items.values(), key=lambda item: (item['code'], item['url'] or '', item['key'] or '', item['detail']))


# --------------------------------------------------------------- serializer

ATTRS = {'a': ('href', 'title'), 'img': ('alt', 'width', 'height'), 'td': ('colspan', 'rowspan'), 'th': ('colspan', 'rowspan', 'scope'), 'ol': ('start',)}
# Joomla's email cloaking writes the address with a script; the captured span holds only the
# "enable JavaScript" notice. The address is never decoded from the script or guessed: the
# notice is replaced by a link to the site's own contact form and the place goes to review.
# The link names the form, not an address: the organiser's address may not be on that page.
CLOAK_ID = re.compile(r'cloak\d+')
CLOAK_REPLACEMENT = '<a href="/kontakt.html">Formularz kontaktowy</a>'
# Services that no longer exist; the link text stays, the dead link does not.
DEAD_HOSTS = frozenset({'plus.google.com'})


def is_email_cloak(node):
    return node.tag == 'span' and bool(CLOAK_ID.fullmatch(node.get('id') or '')) and not select(node, lambda child: child.tag == 'a')


def dead_link(value):
    try:
        return urlsplit((value or '').strip()).hostname in DEAD_HOSTS
    except ValueError:
        return False


class Body:
    """Serialises a content subtree to clean HTML and records the images it keeps."""

    def __init__(self, base, skip=()):
        self.base, self.skip = base, set(map(id, skip))
        self.media, self.rejected = [], []

    def href(self, value):
        """(href, None) for a link the new site can keep, (None, detail) for an own-site link it cannot
        resolve, (None, None) for anything else that is dropped (scripts, other schemes, credentials)."""
        value = (value or '').strip()
        if not value:
            return None, None
        if value.startswith('#') or value.lower().startswith(('mailto:', 'tel:')):
            return value, None
        try:
            parts = urlsplit(urljoin(self.base, value))
            port = parts.port
        except ValueError:
            return None, None
        if parts.scheme not in ('http', 'https') or '@' in parts.netloc:
            return None, None
        if parts.hostname not in HOSTS:
            return urlunsplit(parts), None
        path = safe_page_path(parts.path or '/')
        if path is not None and path in HOME_PATHS and not parts.query:
            return urlunsplit(('', '', '/', '', parts.fragment)), None
        # Joomla component links (/index.php?option=…: cart, checkout, forms, mail-to-friend, article IDs)
        # and direct files (PDF, scripts, non-lightbox images) have no address in the new site. No target is
        # guessed: the text stays, the link goes to review without its query values.
        extension = re.search(r'\.([a-z0-9]{1,5})\Z', (path or '').rsplit('/', 1)[-1], re.I)
        is_file = bool(extension) and re.search(r'[a-z]', extension.group(1), re.I) and extension.group(1).lower() not in ('html', 'htm')
        # Verified public PDFs retain their exact legacy path. The importer maps
        # acquired files to private preview storage and reports missing downloads.
        if not parts.query and parts.path.lower().endswith('.pdf') and own_url(parts, port):
            try:
                pdf_path = unicodedata.normalize('NFC', unquote(parts.path, errors='strict'))
            except UnicodeError:
                pdf_path = ''
            safe_pdf = pdf_path.startswith('/') and not pdf_path.startswith('//') and not re.search(r'[\\\x00-\x1f\x7f-\x9f%?#]', pdf_path) and not re.search(r'%(?:2f|5c|00|3f|23)', parts.path, re.I) and not has_invisible(pdf_path) and all(part not in {'', '.', '..'} and not part.startswith('.env') for part in pdf_path.split('/')[1:])
            if safe_pdf:
                return urlunsplit(('', '', quote(pdf_path, safe='/'), '', parts.fragment)), None
        if parts.query or path is None or is_file or not own_url(parts, port):
            names = sorted({name for name, _ in parse_qsl(parts.query, keep_blank_values=True) if re.fullmatch(r'[\w\[\]-]{1,40}', name)})
            option = next((item for name, item in parse_qsl(parts.query) if name == 'option' and re.fullmatch(r'com_[a-z0-9_]{1,40}', item)), None)
            detail = public_url(urlunsplit(('https', parts.hostname, parts.path, '', '')))
            if names:
                detail += ' query: ' + ', '.join(names) + (f' (option={option})' if option else '')
            return None, detail
        return urlunsplit(('', '', parts.path or '/', '', parts.fragment)), None

    def image(self, node, full=None):
        if (node.get('width') or '').strip() in ('0', '1') or (node.get('height') or '').strip() in ('0', '1'):
            return ''  # tracking pixel
        src = node.get('src') or node.get('data-src') or ''
        ref, reason = (full, None) if full else media_ref(src, self.base)
        if reason:
            self.rejected.append((reason, public_url(src)))
            return ''
        alt = text_value(node.get('alt'))
        self.media.append((ref, alt))
        attrs = f' src="{html_lib.escape(ref["url"])}" alt="{html_lib.escape(alt)}"'
        for name in ('width', 'height'):
            if re.fullmatch(r'[1-9]\d{0,3}', (node.get(name) or '').strip()):
                attrs += f' {name}="{node.get(name).strip()}"'
        return f'<img{attrs}>'

    def lightbox(self, anchor):
        """<a href="big.jpg"><img src="small.jpg"></a>: the full-size file replaces the thumbnail and its link,
        which would point at a file the new site does not serve. Other image links stay links."""
        images = select(anchor, lambda node: node.tag == 'img')
        if len(images) != 1 or text_of(anchor):
            return None
        ref, _ = media_ref(anchor.get('href') or '', self.base)
        return self.image(images[0], ref) if ref else None

    def render(self, root):
        out = []

        def walk(node):
            for child in node.children:
                if isinstance(child, str):
                    out.append(html_lib.escape(child, quote=False))
                    continue
                if id(child) in self.skip:
                    continue
                if child.tag in {'iframe', 'video', 'embed', 'object', 'audio'}:
                    # Preserve a safe video destination as an ordinary link;
                    # never load third-party players or execute legacy embeds.
                    raw = child.get('src') or child.get('data') or ''
                    if not raw:
                        raw = next((descendant.get('src') for descendant in select(child, lambda node: node.tag in {'embed', 'source'} and node.get('src'))), '')
                    try:
                        target = urlsplit(urljoin(self.base, raw))
                        known = target.scheme in {'http', 'https'} and not target.username and not target.password and not target.port and target.hostname in {'www.youtube.com','youtube.com','youtu.be','www.youtube-nocookie.com','youtube-nocookie.com','player.vimeo.com','vimeo.com','www.vimeo.com'}
                        if known and target.scheme == 'http': target = target._replace(scheme='https')
                    except ValueError:
                        known = False
                    if raw and known:
                        out.append(f'<p><a href="{html_lib.escape(urlunsplit(target), quote=True)}">Zobacz nagranie</a></p>')
                    else:
                        self.rejected.append(('unsupported-source-embed', child.tag))
                    continue
                if is_body_excluded(child):
                    continue
                if is_email_cloak(child):
                    self.rejected.append(('email-cloak-not-recovered', 'address written by a script in the source page; notice replaced by a contact form link'))
                    out.append(CLOAK_REPLACEMENT)
                    continue
                if child.tag == 'a' and dead_link(child.get('href')):
                    self.rejected.append(('dead-external-link', public_url(child.get('href') or '')))
                    walk(child)
                    continue
                if child.tag == 'img':
                    out.append(self.image(child))
                    continue
                if child.tag == 'a' and (image := self.lightbox(child)) is not None:
                    out.append(image)
                    continue
                href = None
                if child.tag == 'a':
                    href, problem = self.href(child.get('href'))
                    if problem:
                        self.rejected.append(('internal-link-unresolvable', f'{problem} text: {text_of(child)[:120]}'))
                if not re.fullmatch(r'[a-z][a-z0-9]*', child.tag) or (child.tag == 'a' and href is None):
                    walk(child)  # the link text stays, the link does not
                    continue
                attrs = ''
                for name in ATTRS.get(child.tag, ()):
                    value = href if name == 'href' else child.get(name)
                    if value:
                        attrs += f' {name}="{html_lib.escape(value)}"'
                # The page renders the title as its h1; an h1 inside the source text becomes a section heading.
                tag = 'h2' if child.tag == 'h1' else child.tag
                out.append(f'<{tag}{attrs}>')
                if child.tag not in VOID:
                    walk(child)
                    out.append(f'</{tag}>')
        walk(root)
        # Paragraphs that only held removed images or embeds carry no source text.
        return re.sub(r'\n\s*\n+', '\n', re.sub(r'<p>\s*</p>', '', ''.join(out))).strip()


def text_value(value):
    return re.sub(r'\s+', ' ', value or '').strip()


def seo_of(doc):
    seo = {}
    titles = select(doc, lambda node: node.tag == 'title')
    if titles:
        title = text_value(''.join(child for child in titles[0].children if isinstance(child, str)))
        if title:
            seo['title'] = title
    for meta in select(doc, lambda node: node.tag == 'meta' and (node.get('name') or '').lower() == 'description'):
        description = text_value(meta.get('content'))
        if description:
            seo['description'] = description
            break
    return seo


def base_of(doc, url):
    """Joomla emits <base href>; relative links resolve against it when it stays on the source host."""
    for node in select(doc, lambda node: node.tag == 'base' and node.get('href')):
        candidate = urljoin(url, node.get('href').strip())
        if site_path(candidate) is not None:
            return candidate
        break
    return url


def canonical_of(doc, base):
    for link in select(doc, lambda node: node.tag == 'link' and 'canonical' in (node.get('rel') or '').lower().split()):
        return site_path(link.get('href') or '', base)
    return None


MAX_SOURCE_ID = 2_147_483_647  # the importer's vmId range


def source_id(value):
    """A source database ID exactly as Joomla writes it (1..2^31-1, no sign or leading zero), or None."""
    return int(value) if isinstance(value, str) and re.fullmatch(r'[1-9]\d{0,9}', value) and int(value) <= MAX_SOURCE_ID else None


def search_metadata(doc, base):
    """Query fields of each of the page's own <link rel="search" href="/index.php?…">. Joomla writes the
    shown record there (category, manufacturer, event). None when any search link points to another host,
    carries credentials, a port or a fragment, is malformed, or repeats a query field (even with the
    same value): such metadata names no record. Search links without a query are not metadata."""
    found = []
    for link in select(doc, lambda node: node.tag == 'link' and 'search' in (node.get('rel') or '').lower().split()):
        try:
            parts = urlsplit(urljoin(base, (link.get('href') or '').strip()))
            port = parts.port
            pairs = parse_qsl(parts.query, keep_blank_values=True, strict_parsing=True) if parts.query else []
        except ValueError:
            return None
        if not own_url(parts, port) or parts.fragment:
            return None
        names = [name for name, _ in pairs]
        if len(names) != len(set(names)):
            return None
        if parts.path == '/index.php' and pairs:
            found.append(dict(pairs))
    return found


# --------------------------------------------------------------- categories

CATEGORY_SEGMENT = re.compile(r'\d+-[\w.~-]+')
SHOP_ROOT = 'sklep-nurkowy'


def category_slug(path, navigation=False):
    """'/sklep-nurkowy/12-akcesoria/34-skrzydła.html' -> 'sklep-nurkowy/12-akcesoria/34-skrzydła'.
    The live shop links categories from the site root ('/80-maski-i-fajki/139-maski-nurkowe.html'). Product
    pages have the same shape ('/3625-maska-soprastek-corona.html'), so the root form is a category only with
    navigation=True: a link in the shop breadcrumb trail or in the VirtueMart category menu."""
    if not path:
        return None
    segments = stem_of(path).split('/')
    if len(segments) >= 2 and segments[0] == SHOP_ROOT and all(CATEGORY_SEGMENT.fullmatch(segment) for segment in segments[1:]):
        return '/'.join(segments)
    if navigation and all(CATEGORY_SEGMENT.fullmatch(segment) for segment in segments):
        return '/'.join(segments)
    return None


class CategoryObservations:
    def __init__(self):
        self.data = {}

    def entry(self, slug):
        return self.data.setdefault(slug, {'names': Counter(), 'paths': set(), 'parents': set(), 'vmIds': set(), 'urls': set()})

    def see(self, slug, path, name, parent, url, has_parent=True):
        entry = self.entry(slug)
        entry['paths'].add(path)
        entry['urls'].add(url)
        if name:
            entry['names'][name] += 1
        if has_parent:
            entry['parents'].add(parent)


def menu_category(anchor, base):
    """Category of a VirtueMart menu link; the menu lists categories only, so the root form counts."""
    path = site_path(anchor.get('href') or '', base)
    slug = category_slug(path, navigation=True)
    return (slug, path) if slug else (None, None)


def own_identity(doc, page):
    """Addresses and label that stand for the page itself in its own breadcrumb trail: its path, and for a
    product page its rel=canonical path and its h1. A trail that ends in a link to the product's short address
    names the product, not a category, whether or not that short address was captured."""
    routes, label = {route_key(page['path'])}, None
    containers = product_containers(doc)
    if len(containers) == 1:
        canonical = canonical_of(doc, page['base'])
        if canonical:
            routes.add(route_key(canonical))
        headings = select(containers[0], lambda node: node.tag == 'h1', product_prune)
        if len(headings) == 1 and text_of(headings[0]):
            label = unicodedata.normalize('NFC', text_of(headings[0]))
    return {'routes': routes, 'label': label}


def breadcrumb_categories(doc, page):
    """[(slug, path, name)] per breadcrumb trail, in trail order. A root-form category counts only after the
    trail has passed the shop itself (Strona główna › Sklep nurkowy › Maski i fajki › Maski nurkowe)."""
    own = page['own']
    trails = []
    for crumbs in outermost(select(doc, lambda node: node.has_class('breadcrumbs') or node.has_class('breadcrumb'))):
        trail, in_shop = [], False
        for anchor in select(crumbs, lambda node: node.tag == 'a'):
            path = site_path(anchor.get('href') or '', page['base'])
            if path and stem_of(path) == SHOP_ROOT:
                in_shop = True
                continue
            name = text_of(anchor)
            if path and route_key(path) in own['routes'] or (own['label'] and unicodedata.normalize('NFC', name) == own['label']):
                continue
            slug = category_slug(path, navigation=in_shop)
            if slug:
                trail.append((slug, path, name))
        trails.append(trail)
    return trails


def harvest_navigation(doc, page, observations):
    """Categories from breadcrumb trails and the VirtueMart .VmOpen/.VmClose menu."""
    for trail in breadcrumb_categories(doc, page):
        previous = None
        for slug, path, name in trail:
            observations.see(slug, path, name, previous, page['url'])
            previous = slug
    for item in select(doc, lambda node: node.tag == 'li' and (node.has_class('VmOpen') or node.has_class('VmClose'))):
        anchors = select(item, lambda node: node.tag == 'a', prune=lambda node: node.tag in ('ul', 'ol', 'li'))
        if not anchors:
            continue
        slug, path = menu_category(anchors[0], page['base'])
        if not slug:
            continue
        parent = None
        for ancestor in item.ancestors():
            if ancestor.tag == 'li' and (ancestor.has_class('VmOpen') or ancestor.has_class('VmClose')):
                owner = select(ancestor, lambda node: node.tag == 'a', prune=lambda node: node.tag in ('ul', 'ol', 'li'))
                parent = menu_category(owner[0], page['base'])[0] if owner else None
                break
        observations.see(slug, path, text_of(anchors[0]), parent, page['url'])


def listing_slug(doc, page, observations):
    """Slug of a captured category listing: a /sklep-nurkowy/… page, or a root-form page that breadcrumbs
    or the category menu link as a category. A product page is never a listing."""
    if product_containers(doc):
        return None
    slug = category_slug(page['path'], navigation=True)
    return slug if slug and (slug.startswith(SHOP_ROOT + '/') or slug in observations.data) else None


def category_search_id(doc, base):
    """(ID, problem) from the page's own search link option=com_search&view=category&virtuemart_category_id=N.
    A link with a manufacturer filter names a filtered list, not the category itself. Never from the slug."""
    metadata = search_metadata(doc, base)
    if metadata is None:
        return None, 'a search link is foreign, malformed or repeats a query field'
    ids = set()
    for query in metadata:
        if query.get('option') != 'com_search' or query.get('view') != 'category' or 'virtuemart_category_id' not in query:
            continue
        if query.get('virtuemart_manufacturer_id', '0') != '0':
            continue
        ids.add(source_id(query['virtuemart_category_id']))
    if len(ids) > 1 or None in ids:
        return None, 'conflicting or invalid category IDs in the search links'
    return (ids.pop() if ids else None), None


def harvest_listing(doc, page, observations, report):
    # A captured category listing contributes its heading and, if shown, its numeric source ID
    # (a hidden form input, or the category search link in the page head).
    slug = page['listing']
    if slug:
        observations.see(slug, page['path'], None, None, page['url'], has_parent=False)
        headings = select(doc, lambda node: node.tag == 'h1', prune=is_chrome)
        if len(headings) == 1 and text_of(headings[0]):
            observations.entry(slug)['names'][text_of(headings[0])] += 1
        values = {(node.get('value') or '').strip() for node in select(doc, lambda node: node.tag == 'input' and node.get('name') in ('virtuemart_category_id', 'virtuemart_category_id[]'), prune=is_chrome)}
        values.discard('0')
        values.discard('')
        if len(values) == 1 and next(iter(values)).isdigit():
            observations.entry(slug)['vmIds'].add(int(next(iter(values))))
        elif values:
            observations.entry(slug)['vmIds'].update({'ambiguous'})
        found, problem = category_search_id(doc, page['base'])
        if problem:
            report.add('category-search-id-rejected', page['url'], entity_key('category', slug), problem)
            observations.entry(slug)['vmIds'].add('ambiguous')
        elif found is not None:
            observations.entry(slug)['vmIds'].add(found)


LISTING_RANGE = re.compile(r'Wyników (\d{1,6}) - (\d{1,6}) z (\d{1,6})')
MAX_LISTING = 500  # relation and row limit of the importer


def listing_source_ids(doc, base):
    """((category ID, manufacturer ID), problem) of a VirtueMart browse page from its own <link rel="search">
    (option=com_search, view=category). A missing or zero manufacturer is None, never a default.
    Provenance for consistency checks only; never a relation by itself."""
    metadata = search_metadata(doc, base)
    if metadata is None:
        return (None, None), 'a search link is foreign, malformed or repeats a query field'
    found = set()
    for query in metadata:
        if query.get('option') != 'com_search' or query.get('view') != 'category' or 'virtuemart_category_id' not in query:
            continue
        maker = query.get('virtuemart_manufacturer_id', '0')
        ids = (source_id(query['virtuemart_category_id']), None if maker == '0' else source_id(maker))
        if ids[0] is None or (maker != '0' and ids[1] is None):
            return (None, None), 'invalid category or manufacturer ID in the search link'
        found.add(ids)
    if len(found) > 1:
        return (None, None), 'conflicting search links'
    return (found.pop() if found else (None, None)), None


def browse_listing(doc, page, report):
    """A VirtueMart browse page (category, manufacturer filter or a further results page): its heading,
    the product cards inside .browse-view in page order and the 'Wyników a - b z N' range. Promotion
    boxes and other modules outside .browse-view are never list members. None for other pages."""
    views = outermost(select(doc, lambda node: node.tag == 'div' and node.has_class('browse-view'), prune=is_chrome))
    headings = select(doc, lambda node: node.tag == 'h1' and node.has_class('shop-kateory-title'), prune=is_chrome)
    if len(views) != 1 or len(headings) != 1 or not text_of(headings[0]):
        return None
    view = views[0]
    cards = []
    for container in select(view, lambda node: node.has_class('browseProductContainer')):
        anchors = [anchor for title in select(container, lambda node: node.tag == 'h2' and node.has_class('browseProductTitle')) for anchor in select(title, lambda node: node.tag == 'a')]
        name = text_of(anchors[0]) if len(anchors) == 1 else ''
        if not name or text_problem(name, 500):
            report.add('listing-card-unreadable', page['url'], None, f'{len(anchors)} title links in a product card')
            cards.append(None)
            continue
        prices = {parse_pln_cents(text_of(node)) for node in select(container, lambda node: node.tag == 'span' and node.has_class('price-red'))}
        cards.append({'title': unicodedata.normalize('NFC', name), 'path': site_path(anchors[0].get('href') or '', page['base']), 'priceCents': prices.pop() if len(prices) == 1 else None})
    ranges = {match.groups() for node in select(view, lambda node: node.has_class('display-number')) if (match := LISTING_RANGE.fullmatch(text_of(node)))}
    ids, problem = listing_source_ids(doc, page['base'])
    if problem:
        report.add('listing-source-ids-rejected', page['url'], None, problem)
    listing = {'cards': [card for card in cards if card], 'ids': ids, 'pagination': []}
    if len(cards) > MAX_LISTING:
        raise Skip('field-invalid', f'{len(cards)} product cards, the importer accepts {MAX_LISTING}')
    if len(ranges) == 1:
        first, last, total = map(int, ranges.pop())
        if 1 <= first <= last <= total and last - first + 1 == len(cards) and None not in cards:
            listing['range'] = (first, last, total)
        else:
            report.add('listing-count-mismatch', page['url'], None, f'{len(cards)} cards, page says {first}-{last} of {total}')
    elif cards:
        report.add('listing-count-mismatch', page['url'], None, f'{len(cards)} cards without one readable result range')
    for anchor in select(view, lambda node: node.tag == 'a' and any(parent.has_class('vm-pagination') for parent in node.ancestors())):
        target = site_path(anchor.get('href') or '', page['base'])
        label = text_value(text_of(anchor))
        if target and label and route_key(target) != route_key(page['path']):
            listing['pagination'].append({'path': target, 'label': label})
    descriptions = [node for node in select(doc, lambda node: node.has_class('category_description'), prune=is_chrome)]
    return {'title': text_of(headings[0]), 'description': descriptions[0] if len(descriptions) == 1 and text_of(descriptions[0]) else None, 'listing': listing}


def resolve_categories(observations, report):
    categories = {}
    for slug in sorted(observations.data):
        entry = observations.data[slug]
        key = entity_key('category', slug)
        if not entry['names']:
            report.add('category-missing-name', sorted(entry['urls'])[0], key, slug)
            continue
        ranked = sorted(entry['names'].items(), key=lambda item: (-item[1], item[0]))
        if len(ranked) > 1:
            report.add('category-name-conflict', None, key, ' | '.join(name for name, _ in ranked))
        if not valid_slug(slug):
            report.add('invalid-slug', sorted(entry['urls'])[0], key, f'category slug {slug!r}: allowed are letters, digits, _ ~ - and . inside a segment, at most 200 characters')
            continue
        if problem := text_problem(ranked[0][0], 300):
            report.add('field-invalid', sorted(entry['urls'])[0], key, f'category name: {problem}')
            continue
        paths = sorted(entry['paths'], key=lambda path: (not path.lower().endswith('.html'), path))
        data = {'name': ranked[0][0], 'slug': slug, 'legacyPath': paths[0], 'published': True}
        vm_ids = entry['vmIds']
        if len(vm_ids) == 1 and isinstance(next(iter(vm_ids)), int):
            data['vmId'] = next(iter(vm_ids))
        elif vm_ids:
            report.add('category-vmid-conflict', None, key, slug)
        parents = entry['parents'] or {None}
        parent = next(iter(parents)) if len(parents) == 1 else None
        if len(parents) > 1:
            report.add('category-parent-conflict', None, key, ' | '.join(sorted(str(item) for item in parents)))
        categories[slug] = {'key': key, 'data': data, 'parent': parent}
    for slug, category in categories.items():
        if category['parent'] is not None and category['parent'] not in categories:
            report.add('category-parent-unresolved', None, category['key'], category['parent'])
            category['parent'] = None
    for slug in sorted(categories):
        seen, current = [], slug
        while current is not None and current not in seen:
            seen.append(current)
            current = categories[current]['parent']
        if current is not None:
            for member in seen[seen.index(current):]:
                if categories[member]['parent'] is not None:
                    report.add('category-parent-cycle', None, categories[member]['key'], member)
                    categories[member]['parent'] = None
    return categories


# ---------------------------------------------------------------- products

def product_containers(doc):
    return outermost(select(doc, lambda node: node.has_class('ProductContainer')))


def product_prune(node):
    """Related products inside the container carry their own IDs, prices and images."""
    return is_chrome(node) or is_related(node)


def product_vm_id(container):
    prune = product_prune
    from_price = {int(match.group(1)) for node in select(container, lambda node: bool(node.get('id')), prune)
                  if (match := re.fullmatch(r'productPrice(\d+)', node.get('id')))}
    from_input = {int(value) for node in select(container, lambda node: node.tag == 'input' and node.get('name') in ('virtuemart_product_id', 'virtuemart_product_id[]'), prune)
                  if (value := (node.get('value') or '').strip()).isdigit()}
    found = from_price | from_input
    found.discard(0)
    if not found:
        raise Skip('product-missing-vmid', 'no productPrice<ID> or virtuemart_product_id input')
    if len(found) > 1:
        raise Skip('product-vmid-conflict', ','.join(map(str, sorted(found))))
    return found.pop()


def product_price(container, vm_id):
    prune = product_prune
    scopes = select(container, lambda node: node.get('id') == f'productPrice{vm_id}', prune) or select(container, lambda node: node.has_class('product-price'), prune)
    texts = []
    for scope in scopes:
        texts += [text_of(span) for span in select(scope, lambda node: node.tag == 'span' and node.has_class('PricesalesPrice'), prune)]
    if not texts:
        raise Skip('product-missing-price', 'no span.PricesalesPrice in the product price block')
    values = {parse_pln_cents(text) for text in texts}
    if None in values:
        raise Skip('product-unparsed-price', ' | '.join(texts))
    if len(values) > 1:
        raise Skip('product-ambiguous-price', ' | '.join(texts))
    # An explicit '0,00 zł' is a known source value: the application shows such a product as
    # price on enquiry (no cart, no Offer). A missing price is still skipped above.
    return values.pop()


def product_variants(container, report, url, key):
    """One visible option field becomes variants; several fields would need combinations the page does not state."""
    prune = product_prune
    fields = outermost(select(container, lambda node: node.has_class('product-fields'), prune))
    controls = []
    for field in fields:
        controls += [('select', node) for node in select(field, lambda node: node.tag == 'select', prune)]
        radios = {}
        for node in select(field, lambda node: node.tag == 'input' and (node.get('type') or '').lower() == 'radio', prune):
            radios.setdefault(node.get('name') or '', []).append(node)
        controls += [('radio', nodes) for nodes in radios.values()]
    if not controls:
        return []
    if len(controls) > 1:
        report.add('ambiguous-variants', url, key, f'{len(controls)} option fields; combinations are not shown, description kept')
        return []
    kind, control = controls[0]
    options = []
    if kind == 'select':
        name = control.get('name') or 'select'
        for option in select(control, lambda node: node.tag == 'option'):
            value = (option.get('value') or '').strip()
            label = text_value(''.join(text for text in option.children if isinstance(text, str)))
            if value in ('', '0'):
                continue  # placeholder such as "Wybierz rozmiar"
            options.append((name, value, label))
    else:
        for node in control:
            value = (node.get('value') or '').strip()
            label = ''
            if node.get('id'):
                labels = select(container, lambda candidate: candidate.tag == 'label' and candidate.get('for') == node.get('id'))
                label = text_of(labels[0]) if labels else ''
            if not label and node.parent is not None and node.parent.tag == 'label':
                label = text_of(node.parent)
            if value:
                options.append((node.get('name') or 'radio', value, label))
    if not options:
        return []
    if any(not label for _, _, label in options) or len({value for _, value, _ in options}) != len(options) or len({label for _, _, label in options}) != len(options):
        report.add('ambiguous-variants', url, key, 'option labels or values are missing or repeated')
        return []
    if any(re.search(r'\d[\d\s.]*(?:,\d{2})?\s*(?:zł|pln)|[+-]\s*\d', label, re.I) for _, _, label in options):
        report.add('variant-price-text-not-imported', url, key, 'option labels mention amounts; variants use the product price')
    # stock stays None: the public page has no trusted quantity ("dostępny" is not a number).
    return [{'label': label, 'legacyKey': 'public-option:' + hashlib.sha256((name + '\0' + value).encode('utf-8')).hexdigest(), 'stock': None} for name, value, label in options]


def product_images(container, base, report, url, key):
    prune = product_prune
    holders = select(container, lambda node: node.has_class('main-image') or node.has_class('additional-images'), prune)
    images = []
    for holder in outermost(holders):
        images += select(holder, lambda node: node.tag == 'img', prune)
    images += [node for node in select(container, lambda node: node.tag == 'img' and node.has_class('product-image'), prune) if node not in images]
    refs, seen = [], set()
    for image in images:
        candidates = []
        anchor = next((parent for parent in image.ancestors() if parent.tag == 'a'), None)
        if anchor is not None and anchor.get('href'):
            candidates.append(anchor.get('href'))  # full-size original behind the thumbnail
        candidates.append(image.get('src') or image.get('data-src') or '')
        ref = reason = None
        for candidate in candidates:
            ref, reason = media_ref(candidate, base)
            if ref:
                break
        if not ref:
            report.add(reason, url, key, public_url(candidates[-1]))
            continue
        if ref['path'] not in seen:
            seen.add(ref['path'])
            refs.append((ref, text_value(image.get('alt'))))
    if not refs:
        # Catalogue photos outside the known holders are reported, not guessed: they may belong to another product.
        loose = [node for node in select(container, lambda node: node.tag == 'img', lambda node: prune(node) or node.has_class('product-description'))
                 if (ref := media_ref(node.get('src') or node.get('data-src') or '', base)[0]) and ref['path'].startswith(PRODUCT_IMAGE_DIRS)]
        if loose:
            report.add('product-images-outside-holder', url, key, f'{len(loose)} catalogue images outside .main-image/.additional-images/img.product-image')
    return refs


def analyze_product(doc, page, report):
    containers = product_containers(doc)
    if len(containers) > 1:
        raise Skip('product-ambiguous-container', f'{len(containers)} ProductContainer blocks')
    container = containers[0]
    prune = product_prune
    vm_id = product_vm_id(container)
    key = entity_key('vm-product', str(vm_id))
    headings = select(container, lambda node: node.tag == 'h1', prune)
    if not headings or not text_of(headings[0]):
        raise Skip('product-missing-name', key)
    if len(headings) > 1:
        raise Skip('product-ambiguous-name', key)
    price = product_price(container, vm_id)
    crumbs = [slug for trail in breadcrumb_categories(doc, page) for slug, _, _ in trail]
    # Fallback: the parent of a nested product address; it still has to be an observed category.
    parent = '/'.join(stem_of(page['path']).split('/')[:-1])
    category_candidates = ([crumbs[-1]] if crumbs else []) + ([parent] if category_slug('/' + parent, navigation=True) else [])
    data = {'name': text_of(headings[0]), 'slug': stem_of(page['path']), 'vmId': vm_id, 'priceCents': price, 'stock': None, 'published': True, 'legacyPath': page['path']}
    shorts = select(container, lambda node: node.has_class('product-short-description'), prune)
    if shorts and text_of(shorts[0]):
        data['short'] = text_of(shorts[0])
    descriptions = outermost(select(container, lambda node: node.has_class('product-description'), prune))
    media = []
    if len(descriptions) > 1:
        report.add('product-description-ambiguous', page['url'], key, f'{len(descriptions)} description blocks')
    elif descriptions:
        label = next((node for node in descriptions[0].elements() if node.has_class('title')), None)
        body = Body(page['base'], [label] if label is not None and descriptions[0].elements()[0] is label else [])
        data['body'] = body.render(descriptions[0])
        for reason, src in body.rejected:
            report.add(reason, page['url'], key, src)
        media += [(ref, alt, 'body') for ref, alt in body.media]
    variants = product_variants(container, report, page['url'], key)
    if variants:
        data['variants'] = variants
    media = [(ref, alt, 'images') for ref, alt in product_images(container, page['base'], report, page['url'], key)] + media
    return {'collection': 'products', 'key': key, 'data': data, 'categoryCandidates': category_candidates, 'media': media}


# ------------------------------------------------------- articles and others

CONTENT_AREAS = ('portal-real-content', 'portal-center-site-bar', 'center-sitebar')


def legacy_title(body, area):
    """Joomla 1.5 puts the article title in a sibling before .article-content, not inside it:
    <h2 class="contentheading">…</h2> <div class="article-content">…</div>. The nearest preceding
    .contentheading at the body's level or an ancestor's level, up to the content column, is the title."""
    node = body
    while node is not area and node.parent is not None:
        siblings = node.parent.elements()
        for sibling in reversed(siblings[:next(index for index, item in enumerate(siblings) if item is node)]):
            if is_chrome(sibling):
                continue
            if sibling.has_class('contentheading'):
                return sibling
            inner = select(sibling, lambda candidate: candidate.has_class('contentheading'), prune=is_chrome)
            if inner:
                return inner[-1]
        node = node.parent
    return None


def article_parts(doc):
    """(title, body root, title node). Three layouts: Joomla 3 .item-page, Joomla 1.5 h2.contentheading +
    .article-content, and a single HTML5 article in the content column. One article per page; blog and
    list layouts are reported, because the page does not say which item the URL stands for."""
    items = outermost(select(doc, lambda node: node.has_class('item-page'), prune=is_chrome))
    if len(items) > 1:
        raise Skip('ambiguous-main-content', f'{len(items)} .item-page blocks')
    if not items:
        areas = outermost(select(doc, lambda node: any(node.has_class(name) for name in CONTENT_AREAS), prune=is_chrome))
        legacy = outermost([node for area in areas for node in select(area, lambda node: node.has_class('article-content'), prune=is_chrome)])
        if len(legacy) > 1:
            raise Skip('ambiguous-main-content', f'{len(legacy)} .article-content blocks (blog or list layout)')
        if legacy:
            area = next(area for area in areas if any(parent is area for parent in legacy[0].ancestors()))
            # The h1 inside the article body is an in-text callout on the source site, never its title.
            title_node = legacy_title(legacy[0], area)
            if title_node is None:
                headings = select(legacy[0], lambda child: child.tag == 'h2' and child.has_class('nsp_header'), prune=is_chrome)
                if len(headings) == 1:
                    title_node = headings[0]
            title = text_of(title_node) if title_node is not None else ''
            if not title:
                raise Skip('missing-title', 'no .contentheading before .article-content')
            return title, legacy[0], title_node
        articles = outermost([node for area in areas for node in select(area, lambda node: node.tag == 'article', prune=is_chrome)])
        if len(articles) > 1:
            raise Skip('ambiguous-main-content', f'{len(articles)} article blocks')
        if not articles:
            raise Skip('no-main-content', 'no .item-page, .article-content or article in the content column')
        items = articles
    main = items[0]
    bodies = select(main, lambda node: node.get('itemprop') == 'articleBody', prune=is_chrome)
    body = bodies[0] if len(bodies) == 1 else None
    headings = [node for node in select(main, lambda node: node.tag == 'h1', prune=is_chrome) if body is None or not any(parent is body for parent in node.ancestors())]
    if len(headings) > 1:
        raise Skip('ambiguous-title', f'{len(headings)} h1 headings')
    title_node = headings[0] if headings else next(iter(
        select(main, lambda node: node.get('itemprop') == 'headline', prune=is_chrome)
        + [node for header in select(main, lambda node: node.has_class('page-header'), prune=is_chrome) for node in select(header, lambda node: node.tag == 'h2')]
        + select(main, lambda node: node.tag == 'h2' and node.has_class('contentheading'), prune=is_chrome)), None)
    title = text_of(title_node) if title_node is not None else ''
    if not title:
        raise Skip('missing-title', 'no h1 or article headline')
    return title, (body if body is not None else main), title_node


def contact_parts(doc):
    """Verified aiContactSafe layout: form in the first cell, public staff in the second.
    Never copy the old contact form, its hidden fields, scripts or CAPTCHA.
    """
    tables = select(doc, lambda node: node.tag == 'table' and node.get('id') == 'aiContactSafeForm')
    if len(tables) != 1:
        return None
    rows = [node for node in tables[0].elements() if node.tag == 'tr']
    if len(rows) != 1:
        return None
    cells = [node for node in rows[0].elements() if node.tag == 'td']
    if len(cells) != 2 or not select(cells[0], lambda node: node.get('id') == 'aiContactSafe_contact_form'):
        return None
    if select(cells[1], lambda node: node.tag in {'form', 'input', 'textarea', 'button', 'select'}):
        return None
    if not text_of(cells[1]):
        return None
    return 'Kontakt', cells[1], None


def is_frame(node):
    """Page frame and the left module column. Unlike is_chrome, a right-hand column counts as content:
    the source template puts Joomla blog and contact components there without an .article-content."""
    node_id = node.get('id') or ''
    if node.tag in CHROME_TAGS or any(CHROME_CLASS.match(name) for name in node.classes) or CHROME_ID.match(node_id):
        return True
    return any(is_sidebar_name(name) and re.search(r'left', name, re.I) for name in node.classes)


def in_content_area(node):
    return any(parent.has_class('portal-real-content') for parent in node.ancestors())


def component_root(doc, name):
    roots = outermost(select(doc, lambda node: node.tag == 'div' and node.has_class(name) and in_content_area(node), prune=is_frame))
    return roots[0] if len(roots) == 1 else None


def breadcrumb_label(doc):
    """Literal current-page item that closes the page's only breadcrumb trail in the content column
    ('Jesteś tutaj: Strona główna › Mapa serwisu'): a plain span after the last link. None when the
    trail is missing or repeated, or ends in a link or loose text."""
    trails = outermost(select(doc, lambda node: (node.has_class('breadcrumbs') or node.has_class('breadcrumb')) and in_content_area(node)))
    if len(trails) != 1:
        return None
    items = trails[0].elements()
    last = items[-1] if items else None
    if last is None or last.tag != 'span' or last.has_class('showHere') or select(last, lambda node: node.tag == 'a'):
        return None
    position = next(index for index, child in enumerate(trails[0].children) if child is last)
    if any(not isinstance(child, str) or child.strip() for child in trails[0].children[position + 1:]):
        return None
    return unicodedata.normalize('NFC', text_of(last)) or None


def blog_parts(doc):
    """Joomla category blog (div.blog): title from h2 > span.subheading-category or the blog's own h1;
    body from the category description, the subcategory links and any intro items. A blog page without
    a heading (a further results page that only holds pagination) takes the literal current breadcrumb
    item, else the SEO title. The 'Liczba artykułów' counters are a live database count, not content."""
    blog = component_root(doc, 'blog')
    if blog is None:
        return None
    subheadings = [node for node in blog.elements() if node.tag == 'h2' and select(node, lambda child: child.has_class('subheading-category'))]
    headings = [node for node in blog.elements() if node.tag == 'h1']
    title_node = subheadings[0] if len(subheadings) == 1 else headings[0] if not subheadings and len(headings) == 1 else None
    if title_node is not None and text_of(title_node):
        title, origin = text_of(title_node), 'heading'
    elif subheadings or headings:
        raise Skip('blog-missing-title', f'{len(subheadings)} h2 > span.subheading-category and {len(headings)} h1 headings in the blog')
    elif label := breadcrumb_label(doc):
        title, origin = label, 'breadcrumb'
    elif label := seo_of(doc).get('title'):
        title, origin = label, 'seo'
    else:
        raise Skip('blog-missing-title', 'no heading in the blog, no current breadcrumb item and no SEO title')
    skip = ([title_node] if title_node is not None else []) + select(blog, lambda node: node.tag == 'dl' and any(parent.has_class('cat-children') for parent in node.ancestors()))
    for children in select(blog, lambda node: node.has_class('cat-children')):
        if not select(children, lambda node: node.tag == 'li'):
            skip.append(children)
    return {'title': title, 'origin': origin, 'root': blog, 'skip': skip}


MAX_NAVIGATION = 50


def blog_navigation(blog, page):
    """HTML list of the blog's own pagination links (literal labels, one per target address, not the
    page itself), for a blog page whose only content is that pagination. '' when there is none."""
    body, items, seen = Body(page['base']), [], {route_key(page['path'])}
    for holder in outermost(select(blog, lambda node: node.has_class('pagination'))):
        for anchor in select(holder, lambda node: node.tag == 'a'):
            path = site_path(anchor.get('href') or '', page['base'])
            href, _ = body.href(anchor.get('href'))
            label = text_value(text_of(anchor))
            if not path or not href or not href.startswith('/') or not label or route_key(path) in seen or text_problem(label, 500):
                continue
            seen.add(route_key(path))
            items.append(f'<li><a href="{html_lib.escape(href)}">{html_lib.escape(label, quote=False)}</a></li>')
    return f'<ul>{"".join(items[:MAX_NAVIGATION])}</ul>' if items else ''


def section_intro(blog, page):
    """(intro nodes, teaser paths) of a source blog at a fixed application section: the category
    description is the section's introduction; article teasers, subcategory and 'more' lists repeat
    the list the section renders from imported records, so they are only checked, not copied."""
    root = blog['root']
    intro = outermost(select(root, lambda node: node.has_class('category-desc')))
    teasers = []
    for anchor in select(root, lambda node: node.tag == 'a', prune=lambda node: node.has_class('category-desc') or node.has_class('pagination') or node in blog['skip']):
        path = site_path(anchor.get('href') or '', page['base'])
        if path and path not in teasers and route_key(path) != route_key(page['path']):
            teasers.append(path)
    return intro, teasers


def sitemap_parts(doc):
    """Xmap sitemap (#xmap): its nested menu lists are the content. Title: an own h1, otherwise the
    literal current breadcrumb item. Empty menu titles and the 'Powered by Xmap' credit are dropped;
    breadcrumbs, menus and modules around it are page chrome."""
    maps = outermost(select(doc, lambda node: node.get('id') == 'xmap' and in_content_area(node), prune=is_frame))
    if len(maps) != 1:
        return None
    root = maps[0]
    headings = select(root, lambda node: node.tag == 'h1')
    if len(headings) == 1 and text_of(headings[0]):
        title, skip = text_of(headings[0]), [headings[0]]
    elif headings:
        raise Skip('sitemap-missing-title', f'{len(headings)} h1 headings in #xmap')
    else:
        title, skip = breadcrumb_label(doc), []
        if not title:
            raise Skip('sitemap-missing-title', 'no h1 in #xmap and no current breadcrumb item')
    skip += select(root, lambda node: node.has_class('muted') or (node.tag in ('div', 'h2', 'h3') and not text_of(node) and not select(node, lambda child: child.tag in ('a', 'img'))))
    return title, root, skip


# com_users forms (password reset, username reminder, registration, login). Accounts, passwords and
# their reset codes live in the source database; the old forms, actions and tokens are never copied.
ACCOUNT_COMPONENTS = ('reset', 'remind', 'registration', 'login')


def legacy_account(doc, page):
    """A Joomla com_users form or the VirtueMart customer account (search link view=user)."""
    if select(doc, lambda node: node.tag == 'div' and any(node.has_class(name) for name in ACCOUNT_COMPONENTS) and in_content_area(node), prune=is_frame):
        return True
    return any(query.get('option') == 'com_search' and query.get('view') == 'user' for query in search_metadata(doc, page['base']) or [])


def source_error_response(doc):
    """Joomla error output instead of a page: a bold 'jos-Error' line and a PHP stack trace, no template."""
    return bool(select(doc, lambda node: node.tag == 'b' and text_of(node) == 'jos-Error')) and not select(doc, lambda node: node.has_class('portal-real-content'))


CONTACT_PARTS = ('contact-position', 'contact-address', 'contact-contactinfo', 'contact-misc')
# Joomla's sample text for the contact "misc" field (with its original spelling).
CONTACT_PLACEHOLDERS = frozenset({'Miscellanous info', 'Miscellaneous info'})
CONTACT_FORM_LINK = '<p><a href="/kontakt.html">Formularz kontaktowy</a></p>'


def joomla_contact_parts(doc, report, url):
    """Joomla com_contact person page: the name and its public detail blocks only. The old form,
    its panel headings and slider togglers are never copied; the site's own contact form is linked."""
    contact = component_root(doc, 'contact')
    if contact is None:
        return None
    names = select(contact, lambda node: node.has_class('contact-name'))
    if len(names) != 1 or not text_of(names[0]):
        return None
    parts = []
    for node in outermost(select(contact, lambda child: any(child.has_class(name) for name in CONTACT_PARTS))):
        if node.has_class('contact-misc') and text_of(node) in CONTACT_PLACEHOLDERS:
            report.add('contact-placeholder-omitted', url, None, text_of(node))
            continue
        parts.append(node)
    return text_of(names[0]), parts


def footer_settings(doc):
    """Public company block observed in the source homepage; no configuration files."""
    blocks = select(doc, lambda node: node.has_class('custombox4'))
    if len(blocks) != 1:
        return {}
    match = re.fullmatch(r'(.+?)\s+NIP:\s*(PL\d{10})\s+Regon:\s*\d{9}\s+tel\.\s*(\+?[\d ]{9,30})\s+e-mail:\s*([^\s@]+@[^\s@]+\.[^\s@]+)', text_of(blocks[0]))
    if not match:
        return {}
    address, nip, phone, email = match.groups()
    if len(address) > 2000 or len(email) > 254:
        return {}
    return {'address': address, 'nip': nip, 'phone': phone, 'email': email}


NEXT_COURSE = 'Najbliższy kurs rozpoczyna się'
NEXT_COURSE_DATE = re.compile(NEXT_COURSE + r':\s*(\d{4})-(\d{2})-(\d{2}) o godz\. (\d{2}):(\d{2})(?![\d:])')


def course_next_date(text):
    """('2026-10-12T16:30:00.000Z', None) from exactly one 'Najbliższy kurs rozpoczyna się: 2026-10-12 o godz.
    18:30' in the body text, read as Warsaw local time; otherwise (None, reason) or (None, None) without the phrase."""
    mentions = text.count(NEXT_COURSE)
    if not mentions:
        return None, None
    matches = list(NEXT_COURSE_DATE.finditer(text))
    if mentions > 1:
        return None, f'{mentions} start date mentions'
    if len(matches) != 1:
        return None, 'start date is not written as YYYY-MM-DD o godz. HH:MM'
    year, month, day, hour, minute = map(int, matches[0].groups())
    try:
        local = datetime(year, month, day, hour, minute, tzinfo=ZoneInfo(SITE_ZONE))
    except ValueError:
        return None, 'not a calendar date or time: ' + matches[0].group(0)
    except ZoneInfoNotFoundError:
        return None, f'time zone {SITE_ZONE} is not available'
    # Inside the autumn repeated hour or the spring gap the local time names zero or two instants.
    if local.utcoffset() != local.replace(fold=1).utcoffset():
        return None, 'local time is ambiguous or skipped at a DST change: ' + matches[0].group(0)
    return local.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z'), None


def page_kind(segments):
    route = '/'.join(segments).lower()
    if re.search(r'regulamin|polityka|prywatno|cookies|rodo|reklamacj|zwrot|odst[aą]pien|dostaw|p[lł]atno|warunki-|gwarancj', route):
        return 'legal'
    if len(segments) >= 2 and segments[0] in ('aktualnosci', 'aktualności', 'news'):
        return 'news'
    if len(segments) >= 2 and segments[0].startswith('relacje'):
        return 'report'
    return 'page'


GALLERY_CLASS = re.compile(r'phocagallery|sigplus|sige|gallery|galeria|joomgallery|^jg_', re.I)


def gallery_photos(doc, base):
    holders = outermost(select(doc, lambda node: any(GALLERY_CLASS.search(name) for name in node.classes), prune=is_chrome))
    photos, seen = [], set()
    for holder in holders:
        for image in select(holder, lambda node: node.tag == 'img', prune=is_chrome):
            anchor = next((parent for parent in image.ancestors() if parent.tag == 'a'), None)
            if anchor is not None and anchor.get('href'):
                ref, _ = media_ref(anchor.get('href'), base)  # links to pages are navigation, not photos
                caption = text_value(anchor.get('title')) or text_value(image.get('alt'))
            else:
                ref, _ = media_ref(image.get('src') or '', base)
                caption = text_value(image.get('alt'))
            if ref and ref['path'] not in seen:
                seen.add(ref['path'])
                photos.append((ref, caption))
    return photos


def gallery_folder(doc):
    """Verified Phoca category folders are navigation, not empty albums.
    Keep their explicit child links and thumbnails in the page body. Mixed
    folders retain their photos there too; pure photo albums use the lightbox.
    """
    holders = select(doc, lambda node: node.get('id') == 'phocagallery' and node.has_class('pg-category-view'), prune=is_chrome)
    if len(holders) != 1:
        return None
    holder = holders[0]
    folders = select(holder, lambda node: node.has_class('pg-box-subfolder'))
    if not folders:
        return None
    headings = select(doc, lambda node: node.tag == 'h1', prune=is_chrome)
    if len(headings) != 1 or not text_of(headings[0]):
        raise Skip('gallery-folder-missing-title', f'{len(headings)} h1 headings')
    return text_of(headings[0]), holder, headings[0]


def calendar_day(anchor, page):
    path = site_path(urljoin(page['base'], anchor.get('href') or ''))
    match = re.fullmatch(r'/kalendarz/eventsbyday/(\d{4})/(\d{1,2})/(\d{1,2})/-\.html', path or '')
    return tuple(map(int, match.groups())) if match else None


def calendar_event_day(anchor, cell, page):
    days = {calendar_day(day, page) for day in select(cell, lambda node: node.tag == 'a' and node.has_class('cal_daylink'))} - {None}
    if len(days) == 1:
        return next(iter(days))
    # Verified Underwater JEvents grid: one TD holds a seven-day header and
    # event rows. jevblocksN spans N day columns (source w905.css); the zero
    # block has zero width. Use the explicit header date at the start column,
    # never generate extra dates or an end time for a multi-day event.
    headers = [child for child in cell.elements() if child.tag == 'div' and child.has_class('jevdaydata')]
    row = next((node for node in anchor.ancestors() if node.has_class('jeveventrow') and node.parent is cell), None)
    if len(headers) != 1 or row is None:
        return None
    columns = headers[0].elements()
    if len(columns) != 7 or not all(node.has_class('jev_daynum') for node in columns):
        return None
    dates = []
    for column in columns:
        links = select(column, lambda node: node.tag == 'a' and node.has_class('cal_daylink'))
        dates.append(calendar_day(links[0], page) if len(links) == 1 else None)
    block = next((node for node in anchor.ancestors() if node.parent is row), None)
    offset = 0
    selected = None
    for child in row.elements():
        widths = [int(match.group(1)) for name in child.classes if (match := re.fullmatch(r'jevblocks([0-7])', name))]
        width = widths[0] if len(widths) == 1 else 1 if not widths and child.has_class('jev_dayoutofmonth') else None
        if width is None:
            return None
        if child is block and width > 0 and offset < 7:
            selected = dates[offset]
        offset += width
    return selected if offset == 7 else None


def warsaw_instant(year, month, day, hour, minute):
    """UTC ISO instant of an explicit Warsaw wall-clock time. ValueError for a date or time that does
    not exist, and for a local time that is ambiguous or skipped at a DST change: never normalised."""
    local = datetime(year, month, day, hour, minute, tzinfo=ZoneInfo(SITE_ZONE))
    if local.utcoffset() != local.replace(fold=1).utcoffset():
        raise ValueError('ambiguous local time')
    if local.astimezone(timezone.utc).astimezone(local.tzinfo).replace(tzinfo=None) != local.replace(tzinfo=None):
        raise ValueError('nonexistent local time')
    return local.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


# JEvents detail header, as the source prints it (Polish month names in the nominative):
#   'Od Piątek, 2. październik 2026 - 16:00' / 'Do Niedziela, 4. październik 2026 - 21:00'
#   'Środa, 26. sierpień 2026, 19:00 - 20:00'      'Piątek, 24. kwiecień 2026, 09:00'
EVENT_DETAIL_PATH = re.compile(r'/kalendarz/eventdetail/(\d{1,10})/-/[^/]+\.html')
PL_MONTHS = {name: index for index, name in enumerate(('styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'), 1)}
PL_WEEKDAYS = ('Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota', 'Niedziela')
EVENT_DAY = r'(\w+), (\d{1,2})\. (\w+) (\d{4})'
EVENT_CLOCK = r'(\d{2}):(\d{2})'
EVENT_FORMS = (
    ('range', re.compile(rf'Od {EVENT_DAY} - {EVENT_CLOCK}\nDo {EVENT_DAY} - {EVENT_CLOCK}')),
    ('same-day', re.compile(rf'{EVENT_DAY}, {EVENT_CLOCK} - {EVENT_CLOCK}')),
    ('start', re.compile(rf'{EVENT_DAY}, {EVENT_CLOCK}')),
)


class EventFallback(Exception):
    def __init__(self, code, detail=''):
        super().__init__(code)
        self.code, self.detail = code, detail


def event_lines(span):
    """Text lines of the date span; <br> separates them, whitespace runs collapse within a line."""
    parts = []
    for child in span.children:
        parts.append(child if isinstance(child, str) else '\n' if child.tag == 'br' else text_of(child))
    lines = [re.sub(r'\s+', ' ', line).strip() for line in unicodedata.normalize('NFC', ''.join(parts)).split('\n')]
    return [line for line in lines if line]


def event_instant(weekday, day, month, year, hour, minute, literal):
    if month not in PL_MONTHS:
        raise EventFallback('event-date-month-unknown', literal)
    try:
        weekday_index = datetime(int(year), PL_MONTHS[month], int(day)).weekday()
    except ValueError:
        raise EventFallback('event-date-invalid', literal) from None
    if PL_WEEKDAYS[weekday_index] != weekday:
        raise EventFallback('event-date-weekday-mismatch', f'{literal} ({int(day)}.{PL_MONTHS[month]:02d}.{year} is {PL_WEEKDAYS[weekday_index]})')
    try:
        return warsaw_instant(int(year), PL_MONTHS[month], int(day), int(hour), int(minute))
    except ValueError as error:
        raise EventFallback('event-date-invalid', f'{literal}: {error}') from None
    except ZoneInfoNotFoundError:
        raise EventFallback('event-date-invalid', f'time zone {SITE_ZONE} is not available') from None


def event_dates(lines):
    """(startsAt, endsAt or None) from the exact header text; the year is always the printed one."""
    literal = ' / '.join(lines)
    text = '\n'.join(lines)
    for form, pattern in EVENT_FORMS:
        match = pattern.fullmatch(text)
        if not match:
            continue
        values = match.groups()
        if form == 'range':
            starts = event_instant(*values[:6], literal)
            ends = event_instant(*values[6:], literal)
        elif form == 'same-day':
            starts = event_instant(*values[:6], literal)
            ends = event_instant(*values[:4], *values[6:], literal)
        else:
            starts, ends = event_instant(*values, literal), None
        if ends is not None and ends < starts:
            raise EventFallback('event-date-end-before-start', literal)
        return starts, ends
    if any(re.fullmatch(rf'(?:(?:Od|Do) )?{EVENT_DAY}', line) for line in lines):
        # An all-day entry: no time is invented for it.
        raise EventFallback('event-date-missing-time', literal)
    raise EventFallback('event-date-unparsed', literal or 'empty date line')


def event_evid(doc, base):
    """evid=<ID> values of the page's own <link rel="search"> (JEvents writes the shown event there); None
    when the search metadata is rejected (another host, a repeated query field). Several values conflict."""
    metadata = search_metadata(doc, base)
    if metadata is None:
        return None
    return {query['evid'] for query in metadata if 'evid' in query}


def event_detail(doc, page, report):
    """A JEvents event detail page (#jevents_body.jeventpage with its 'Wróć' link) becomes an event when
    its ID and date header are exact; anything else keeps its literal text as a page. Returns None for
    other pages."""
    containers = select(doc, lambda node: node.get('id') == 'jevents_body' and node.has_class('jeventpage'))
    if len(containers) != 1:
        return None
    container = containers[0]
    backs = [node for node in select(container, lambda node: node.tag == 'p') if select(node, lambda child: child.tag == 'a' and child.has_class('jev_back'))]
    if not backs:
        if page['path'] != '/kalendarz.html':
            report.add('jevents-not-event-detail', page['url'], None, 'informational: a JEvents page without an event detail')
        return None
    seo = seo_of(doc)
    elements = container.elements()
    header = elements[0] if elements and elements[0].tag == 'table' else None
    cells, content = [], None
    if header is not None:
        rows = select(header, lambda node: node.tag == 'tr', prune=lambda node: node.tag == 'table' and node is not header)
        cells = [node for node in rows[0].elements() if node.tag == 'td'] if len(rows) == 1 else []
        following = elements[1] if len(elements) > 1 else None
        content = following if following is not None and following.tag == 'div' else None
    headings = select(cells[0], lambda node: node.tag == 'h1') if len(cells) == 2 else []
    title = text_of(headings[0]) if len(headings) == 1 else seo.get('title', '')
    if not title:
        raise Skip('missing-title', 'event detail without an h1 or <title>')
    path_id = EVENT_DETAIL_PATH.fullmatch(page['path'])
    key = entity_key('page', page['path'].lstrip('/'))
    base = {'title': title, 'path': page['path'], 'published': True, 'legacyPath': page['path']}
    if seo:
        base['seo'] = seo

    def page_form():
        """The whole header text stays literal in the body; nothing is turned into a date."""
        literal = Body(page['base'], backs)
        if len(cells) == 2 and content is not None:
            html = literal.render(cells[1]) + literal.render(content)
        else:
            html = literal.render(container)
        return {'collection': 'pages', 'key': key, 'data': {**base, 'kind': 'page', 'body': html}, 'media': [(ref, alt, 'body') for ref, alt in literal.media], 'rejected': literal.rejected}

    def fallback(code, detail):
        report.add(code, page['url'], key, detail)
        return page_form()

    if len(cells) != 2 or len(headings) != 1 or content is None:
        return fallback('event-header-unrecognized', 'expected a one-row header table (title, date) followed by the event text')
    evids = event_evid(doc, page['base'])
    if not path_id or source_id(path_id.group(1)) is None or evids != {path_id.group(1)}:
        shown = 'rejected search metadata' if evids is None else ', '.join(sorted(evids)) or 'missing'
        return fallback('event-id-mismatch', f'path ID {path_id.group(1) if path_id else "missing"}, page evid {shown}')
    paragraphs = [node for node in cells[1].elements() if node.tag == 'p']
    spans = [node for node in paragraphs[0].elements() if node.tag == 'span'] if len(paragraphs) == 1 else []
    if not spans:
        return fallback('event-header-unrecognized', 'no date in the header')
    try:
        starts, ends = event_dates(event_lines(spans[0]))
    except EventFallback as problem:
        return fallback(problem.code, problem.detail)
    body = Body(page['base'])
    html = body.render(content)
    data = {**base, 'startsAt': starts}
    if ends is not None:
        data['endsAt'] = ends
    if len(spans) == 3:
        location = text_of(spans[1])
        if location and not text_problem(location, 500):
            data['location'] = location
        elif location:
            report.add('field-omitted', page['url'], key, 'event location: ' + text_problem(location, 500))
        contact = body.render(spans[2])
        if contact:
            html = f'<p>{contact}</p>' + html
    else:
        # Without the exact date, place and contact spans the whole header text stays in the body.
        header_body = Body(page['base'])
        html = header_body.render(cells[1]) + html
        body.media = header_body.media + body.media
        body.rejected += header_body.rejected
    data['body'] = html
    # The page form is used only if the month calendar lists this event at another time.
    return {'collection': 'events', 'key': 'jevents-detail:' + path_id.group(1), 'data': data, 'media': [(ref, alt, 'body') for ref, alt in body.media], 'rejected': body.rejected, 'fallback': page_form()}


def calendar_events(doc, page, report):
    """Literal JEvents month cells: one explicit day URL and HH:MM event text.
    Dates come from the day link, never the page capture clock or guessed year.
    Do not follow infinite calendar navigation or invent quotas/end dates.
    """
    if page['path'] != '/kalendarz.html':
        return []
    result = {}
    for anchor in select(doc, lambda node: node.tag == 'a' and node.has_class('cal_titlelink')):
        cell = next((node for node in anchor.ancestors() if node.tag == 'td'), None)
        if cell is None:
            continue
        date_parts = calendar_event_day(anchor, cell, page)
        value = text_of(anchor)
        clock = re.fullmatch(r'(\d{1,2}):(\d{2})\s+(.+)', value)
        if date_parts is None or not clock:
            report.add('calendar-event-unresolved', page['url'], None, 'event lacks one explicit source day and time')
            continue
        year, month, day = date_parts
        title = clock.group(3)
        if text_problem(title, 500):
            report.add('calendar-event-unresolved', page['url'], None, 'event title exceeds the importer limits')
            continue
        try:
            starts = warsaw_instant(year, month, day, int(clock.group(1)), int(clock.group(2)))
        except (ValueError, ZoneInfoNotFoundError):
            report.add('calendar-event-unresolved', page['url'], None, 'invalid explicit source date/time')
            continue
        identity = hashlib.sha256((starts + '\0' + title).encode()).hexdigest()
        result[identity] = {'key': 'public-calendar-event:' + identity, 'data': {'title': title, 'startsAt': starts, 'published': True}, 'href': safe_page_path(urlsplit(urljoin(page['base'], anchor.get('href') or '')).path)}
    return list(result.values())


def analyze_content(doc, page, report):
    segments = stem_of(page['path']).split('/')
    seo = seo_of(doc)
    is_html = page['path'].lower().endswith('.html')
    section = '/'.join(segments) in FIXED_ROUTES
    folder = gallery_folder(doc) if segments[0].startswith('galeri') else None
    if segments[0].startswith('galeri') and not section and folder is None:
        photos = gallery_photos(doc, page['base'])
        if photos:
            headings = select(doc, lambda node: node.tag == 'h1', prune=is_chrome)
            if len(headings) != 1 or not text_of(headings[0]):
                raise Skip('album-missing-title', f'{len(headings)} h1 headings')
            key = entity_key('album', page['path'].lstrip('/'))
            data = {'title': text_of(headings[0]), 'path': page['path'], 'legacyPath': page['path'], 'published': True}
            if seo:
                data['seo'] = seo
            return {'collection': 'albums', 'key': key, 'data': data, 'media': [(ref, caption, 'photos') for ref, caption in photos]}
    contact = contact_parts(doc) if '/'.join(segments) == 'kontakt' else None
    blog = person = sitemap = intro = article = None
    teasers = []
    if folder is None and contact is None and not section:
        blog = blog_parts(doc)
        person = joomla_contact_parts(doc, report, page['url']) if blog is None else None
        sitemap = sitemap_parts(doc) if blog is None and person is None else None
    elif folder is None and contact is None:
        # A fixed section shows its own list. A source article there stays as before; a source blog
        # gives only its literal title, SEO and introduction, never a copy of the list above that list.
        try:
            article = article_parts(doc)
        except Skip:
            intro = blog_parts(doc)
            if intro is None:
                raise
    if blog is not None:
        title = blog['title']
        body = Body(page['base'], blog['skip'])
        html = body.render(blog['root'])
        if not text_of(parse_html(html)) and not body.media:
            html = blog_navigation(blog['root'], page)
            if html:
                report.add('blog-navigation-only', page['url'], None, 'informational: the source blog page holds only pagination; its own links are kept, nothing else is added')
    elif intro is not None:
        title = intro['title']
        nodes, teasers = section_intro(intro, page)
        body = Body(page['base'], intro['skip'])
        html = '\n'.join(filter(None, (body.render(node) for node in nodes)))
    elif person is not None:
        title, parts = person
        body = Body(page['base'])
        html = '\n'.join(filter(None, (body.render(part) for part in parts)))
        html = (html + '\n' if html else '') + CONTACT_FORM_LINK
    elif sitemap is not None:
        title, root, skip = sitemap
        body = Body(page['base'], skip)
        html = body.render(root)
    else:
        title, root, title_node = folder if folder is not None else contact if contact is not None else article if article is not None else article_parts(doc)
        body = Body(page['base'], [title_node] if title_node is not None else [])
        html = body.render(root)
    if not text_of(parse_html(html)) and not body.media:
        if intro is None:
            raise Skip('empty-main-content', title)
        html = ''  # the section record still carries the literal title and SEO
    # A Joomla blog, contact component or sitemap is a page whatever its address looks like.
    forced_page = blog is not None or person is not None or sitemap is not None
    # '/kursy-nurkowania/kursy-nurkowania-<…>.html' is a course overview on the source site, not a course.
    landing = segments[0] == 'kursy-nurkowania' and len(segments) == 2 and segments[1].startswith('kursy-nurkowania-')
    course_root = segments[0] in {'kursy-nurkowania', 'kursy-specjalizacji-nurkowych-padi'}
    if course_root and len(segments) == 2 and is_html and not section and not landing and not forced_page:
        key = entity_key('course', segments[1])
        # Only an explicit organisation in the source title is authoritative.
        organisations = [name for name in ('PADI', 'IANTD', 'TDI/SDI', 'Freediving') if re.search(r'(?<!\w)' + re.escape(name) + r'(?!\w)', title, re.I)]
        data = {'name': title, 'slug': segments[1], 'body': html, 'org': organisations[0] if len(organisations) == 1 else None, 'published': True, 'legacyPath': page['path']}
        collection = 'courses'
        next_date, reason = course_next_date(text_of(parse_html(html)))
        if next_date:
            data['nextDate'] = next_date
        elif reason:
            report.add('course-date-not-imported', page['url'], key, reason + '; the sentence stays in the body')
    elif segments[0] == 'wyprawy-nurkowe' and len(segments) == 2 and is_html and not forced_page:
        key = entity_key('trip', page['path'].lstrip('/'))
        data = {'title': title, 'path': page['path'], 'body': html, 'published': True, 'legacyPath': page['path']}
        collection = 'trips'
    else:
        key = entity_key('page', page['path'].lstrip('/'))
        data = {'title': title, 'path': page['path'], 'kind': page_kind(segments), 'body': html, 'published': True, 'legacyPath': page['path']}
        if not html:
            del data['body']
        collection = 'pages'
        if section:
            report.add('source-section-content', page['url'], key, f'informational: the application section at {page["path"]} uses this record for its title, SEO and introduction')
            if teasers:
                report.add('source-section-teasers-omitted', page['url'], key, f'informational: {len(teasers)} list links of the source blog are not copied; the section lists imported records')
        elif landing:
            report.add('course-landing-page', page['url'], key, 'informational: course overview imported as a page, not as a course')
        elif blog is not None:
            report.add('blog-imported-as-page', page['url'], key, 'informational: category blog imported as a page; its article counters are not copied')
        elif sitemap is not None:
            report.add('sitemap-imported-as-page', page['url'], key, 'informational: the source sitemap lists are kept as the page body')
    if seo:
        data['seo'] = seo
    origin = (blog or intro or {}).get('origin')
    if origin in ('breadcrumb', 'seo'):
        report.add(f'blog-title-from-{origin}', page['url'], key, f'informational: the source blog has no heading; the title is its literal {origin} label')
    for reason, src in body.rejected:
        report.add(reason, page['url'], key, src)
    candidate = {'collection': collection, 'key': key, 'data': data, 'media': [(ref, alt, 'body') for ref, alt in body.media]}
    if teasers:
        candidate['sectionLinks'] = teasers
    return candidate


# ------------------------------------------------------------------ pipeline

def prepare_pages(pages, report):
    if not isinstance(pages, list):
        raise ValueError('pages must be a list of {url, html, sha256, charset?}')
    if len(pages) > MAX_PAGES:
        raise ValueError('Too many pages for one conversion.')
    by_url = {}
    for index, record in enumerate(pages):
        if not isinstance(record, dict) or not isinstance(record.get('url'), str) or not isinstance(record.get('html'), str) or not re.fullmatch(r'[a-f0-9]{64}', str(record.get('sha256', ''))):
            report.skip('invalid-page-record', None, f'record {index}')
            continue
        url, markup = record['url'], record['html']
        if len(markup) > MAX_HTML:
            report.skip('page-too-large', url)
            continue
        charset = record.get('charset') or 'utf-8'
        try:
            digest = hashlib.sha256(markup.encode(charset)).hexdigest()
        except (LookupError, UnicodeEncodeError):
            digest = None
        if digest != record['sha256']:
            report.skip('integrity-mismatch', url, 'html does not re-encode to the recorded sha256')
            continue
        path = site_path(url)
        if not path:
            report.skip('out-of-scope-url', url, 'not a plain https://www.underwater.pl path')
            continue
        by_url.setdefault(path, []).append({'url': url, 'path': path, 'html': markup, 'sha256': record['sha256']})
    prepared = []
    for path in sorted(by_url):
        rows = by_url[path]
        unique = {}
        for row in sorted(rows, key=lambda row: row['url']):
            unique.setdefault(row['sha256'], row)
        # Legacy form tokens and template counters alter the full-page hash.
        # Keep each distinct capture for semantic classification below: the
        # merge still rejects different prices, variants, bodies and images.
        prepared.extend(unique.values())
        report.skipped['duplicate-page-capture'] += len(rows) - len(unique)
    return prepared


# Field limits of src/lib/import/bundle.ts fieldSpecs, in JavaScript string length.
TITLE_LIMITS = {'categories': ('name', 300), 'products': ('name', 300), 'courses': ('name', 300),
                'pages': ('title', 500), 'trips': ('title', 500), 'albums': ('title', 500), 'events': ('title', 500)}
ROW_LIMITS = {'images': 500, 'photos': 2000}


def text_problem(value, limit):
    if js_len(value) > limit:
        return f'longer than {limit} characters ({js_len(value)})'
    if CONTROL.search(value):
        return 'contains control characters'
    return None


def check_fields(candidate, report, url):
    """Source content the importer would reject is never shortened. A record whose own text (name, title,
    slug, short, body, variant labels) or image count breaks a limit is skipped and reported; optional page
    metadata (SEO title and description, photo captions) is left out and reported."""
    collection, key, data = candidate['collection'], candidate['key'], candidate['data']
    name, limit = TITLE_LIMITS[collection]
    if problem := text_problem(data[name], limit):
        raise Skip('field-invalid', f'{key} {name}: {problem}')
    if 'slug' in data and not valid_slug(data['slug'], nested=collection != 'courses'):
        raise Skip('invalid-slug', f'{key} slug {data["slug"]!r}: allowed are letters, digits, _ ~ - and . inside a segment, at most 200 characters')
    if 'short' in data and (problem := text_problem(data['short'], 5000)):
        raise Skip('field-invalid', f'{key} short: {problem}')
    if js_len(data.get('body', '')) > 1_000_000:
        raise Skip('field-invalid', f'{key} body: HTML longer than 1 000 000 characters')
    variants = data.get('variants', [])
    if len(variants) > 500 or any(text_problem(variant['label'], 300) for variant in variants):
        raise Skip('field-invalid', f'{key} variants: more than 500 or a label over 300 characters or with control characters')
    for field, maximum in ROW_LIMITS.items():
        count = len({ref['path'] for ref, _, target in candidate['media'] if target == field})
        if count > maximum:
            raise Skip('field-invalid', f'{key} {field}: {count} images, the importer accepts {maximum}')
    seo = data.get('seo', {})
    for field, maximum in (('title', 300), ('description', 2000)):
        if field in seo and (problem := text_problem(seo[field], maximum)):
            report.add('field-omitted', url, key, f'seo.{field}: {problem}')
            del seo[field]
    if 'seo' in data and not seo:
        del data['seo']
    media = []
    for ref, caption, target in candidate['media']:
        if target == 'photos' and caption and (problem := text_problem(caption, 1000)):
            report.add('field-omitted', url, key, f'photo caption of {ref["path"]}: {problem}')
            caption = ''
        media.append((ref, caption, target))
    candidate['media'] = media


def analyze_listing(doc, page, report, browse):
    """A browse page becomes a page with a controlled product list. Members are resolved later against
    imported products by exact address; the card prices, names and filter never change a product."""
    key = entity_key('page', page['path'].lstrip('/'))
    data = {'title': browse['title'], 'path': page['path'], 'kind': 'page', 'listing': True, 'published': True, 'legacyPath': page['path']}
    media = []
    if browse['description'] is not None:
        body = Body(page['base'])
        html = body.render(browse['description'])
        if text_of(parse_html(html)) or body.media:
            data['body'] = html
            media = [(ref, alt, 'body') for ref, alt in body.media]
        for reason, src in body.rejected:
            report.add(reason, page['url'], key, src)
    if 'range' in browse['listing']:
        data['listingFrom'], data['listingTo'], data['listingTotal'] = browse['listing']['range']
    seo = seo_of(doc)
    if seo:
        data['seo'] = seo
    return {'collection': 'pages', 'key': key, 'data': data, 'media': media, 'listing': browse['listing']}


def classify(doc, page, report, categories=frozenset()):
    if page['path'] in HOME_PATHS:
        report.skip('home-landing', page['url'], review=False)
        return None
    if source_error_response(doc):
        # The response text is a server path stack trace: never content, never quoted in the report.
        report.skip('source-error-response', page['url'], 'Joomla error output instead of a page; nothing imported')
        return None
    calendar_candidate = None
    # The fixed calendar renders its current event records. Keep the source section's
    # literal heading and SEO, without importing its old month table or navigation.
    if page['path'] == '/kalendarz.html':
        headers = select(doc, lambda n: n.get('id') == 'jevents_header' and n.has_class('jeventpage'))
        headings = select(headers[0], lambda n: n.tag == 'h2') if len(headers) == 1 else []
        if len(headings) == 1 and text_of(headings[0]):
            data = {'title': text_of(headings[0]), 'path': page['path'], 'kind': 'page', 'published': True, 'legacyPath': page['path']}
            seo = seo_of(doc)
            if seo:
                data['seo'] = seo
            calendar_candidate = {'collection': 'pages', 'key': entity_key('page', page['path'].lstrip('/')), 'data': data, 'media': []}
    try:
        if calendar_candidate is not None:
            candidate = calendar_candidate
            report.add('source-section-content', page['url'], candidate['key'], 'literal calendar title and SEO; current events are rendered separately')
        elif product_containers(doc):
            candidate = analyze_product(doc, page, report)
            seo = seo_of(doc)
            if seo:
                candidate['data']['seo'] = seo
            candidate['canonical'] = canonical_of(doc, page['base'])
        elif stem_of(page['path']) == SHOP_ROOT or page['listing'] in categories:
            # The category record owns this address and lists its products from the catalogue.
            report.skip('category-listing', page['url'], review=False)
            return None
        elif legacy_account(doc, page):
            report.skip('legacy-account-requires-source-database', page['url'], 'customer account, login or password form of the old site; accounts need the source database and a separate decision, the form is not copied')
            return None
        elif (event := event_detail(doc, page, report)) is not None:
            candidate = event
            for reason, src in candidate.pop('rejected'):
                report.add(reason, page['url'], candidate['key'], src)
        elif (browse := browse_listing(doc, page, report)) is not None:
            candidate = analyze_listing(doc, page, report, browse)
        elif page['listing']:
            report.skip('category-listing', page['url'], review=False)
            return None
        elif stem_of(page['path']).split('/')[0] == 'list-all-products':
            # Shop chrome only (menus, cart, promotions): the source served no product list here, so
            # this is a missing shop component, not an empty manufacturer inventory.
            cards = len(select(doc, lambda node: node.has_class('browseProductContainer'), prune=is_chrome))
            report.skip('shop-component-missing', page['url'], f'VirtueMart manufacturer address without one browse view and list heading ({cards} product cards); no empty list is created')
            return None
        else:
            candidate = analyze_content(doc, page, report)
        check_fields(candidate, report, page['url'])
        if candidate.get('fallback'):
            try:
                check_fields(candidate['fallback'], report, page['url'])
            except Skip as skip:
                report.add(skip.code, page['url'], candidate['fallback']['key'], 'page form of the event: ' + skip.detail)
                del candidate['fallback']
    except Skip as skip:
        report.skip(skip.code, page['url'], skip.detail)
        return None
    candidate.update({'url': page['url'], 'path': page['path']})
    return candidate


def fingerprint(candidate):
    data = {name: value for name, value in candidate['data'].items() if name not in ('slug', 'legacyPath', 'path', 'seo')}
    return stable_hash({'data': data, 'category': candidate.get('category'), 'listing': candidate.get('listing'), 'media': [(ref['path'], alt, field) for ref, alt, field in candidate['media']]})


def merge_candidates(candidates, report):
    """Same source identity: keep one record when content is equal, otherwise report and drop all."""
    groups = {}
    for candidate in candidates:
        groups.setdefault((candidate['collection'], candidate['key']), []).append(candidate)
    merged, redirects = [], []
    for (collection, key), group in sorted(groups.items()):
        group.sort(key=lambda item: item['url'])
        if len({fingerprint(item) for item in group}) > 1:
            report.add('conflicting-source-content', None, f'{collection}:{key}', ' | '.join(item['url'] for item in group))
            continue
        by_path = {}
        for item in group:
            by_path.setdefault(item['path'], set()).add(stable_hash(item['data'].get('seo', {})))
        if any(len(values) > 1 for values in by_path.values()):
            report.add('conflicting-page-metadata', None, f'{collection}:{key}', 'different SEO values in captures of the same source address')
            continue
        paths = sorted({item['path'] for item in group}, key=lambda path: (len(path), path))
        hinted = {item.get('canonical') for item in group} & set(paths)
        primary_path = hinted.pop() if len(hinted) == 1 else paths[0]
        primary = next(item for item in group if item['path'] == primary_path)
        merged.append(primary)
        # One redirect per other address as the importer keys it. '/x' next to '/x.html' is the same
        # address there (a redirect between them would point to itself), so it needs none.
        aliases = {}
        for alias in sorted(paths, key=lambda path: (not path.lower().endswith('.html'), len(path), path)):
            route = route_key(alias)
            if alias == primary_path:
                continue
            if route == route_key(primary_path) or route in aliases:
                report.skipped['same-route-alias'] += 1
                continue
            aliases[route] = alias
        for alias in aliases.values():
            redirects.append({'collection': 'redirects', 'key': entity_key('alias', alias.lstrip('/')), 'target': (collection, key), 'media': [],
                              'data': {'from': alias, 'to': primary_path, 'reason': (f'Ten sam produkt VirtueMart (ID {primary["data"].get("vmId")}) pod drugim publicznym adresem' if collection == 'products' else 'Ten sam rekord źródłowy pod drugim publicznym adresem'), 'published': True}})
    return merged, redirects


def claims_of(entity):
    """Everything validateBundle() requires to be unique across the bundle: public routes (routeKey of
    legacyPath/path/from, product and category slugs, kursy-nurkowania/<course slug>) and per-collection
    unique fields (slug, vmId, path, from)."""
    collection, data = entity['collection'], entity['data']
    routes = set()
    for name in ('legacyPath', 'path', 'from'):
        if data.get(name):
            routes.add(route_key(data[name]))
    if collection in ('products', 'categories'):
        routes.add(data['slug'])
    if collection == 'courses':
        routes.add('kursy-nurkowania/' + data['slug'])
    claims = {('route', route) for route in routes}
    for name in ('slug', 'vmId', 'path', 'from'):
        if data.get(name) is not None:
            claims.add((collection, name, data[name]))
    return claims


def merge_event_details(entities, calendar_rows, merged, report, resolve=route_key):
    """One record per source event. An event page whose address and start equal one month-calendar
    entry fills that entry (its import key stays, so no record is orphaned); a different start keeps
    the calendar entry and imports the event page as a page. resolve() maps a month-cell address to
    the route of the event page it reaches by a captured HTTP redirect or a second capture of the same
    event. A course term is linked only for the exact course name and start; then the course's own
    fallback calendar entry is not added. Returns {old entity id: new entity id} for records that moved."""
    moved, rows_by_route, courses, linked = {}, {}, {}, {}
    for event in calendar_rows:
        if event['href'] and 'events:' + event['key'] in entities:
            rows_by_route.setdefault(resolve(event['href']), []).append('events:' + event['key'])
    for candidate in merged:
        if candidate['collection'] == 'courses' and candidate['data'].get('nextDate'):
            courses.setdefault(unicodedata.normalize('NFC', candidate['data']['name']), []).append(candidate)
    for identifier, entity in entities.items():
        if entity['collection'] == 'events' and entity['relations'].get('courseSession'):
            linked.setdefault(entity['relations']['courseSession'], identifier)
    details = sorted(identifier for identifier, entity in entities.items() if entity['collection'] == 'events' and entity['key'].startswith('jevents-detail:'))
    for identifier in details:
        detail = entities.pop(identifier)
        rows = rows_by_route.get(route_key(detail['data']['path']), [])
        if rows:
            same = [row for row in rows if entities[row]['data']['startsAt'] == detail['data']['startsAt']]
            if len(rows) != 1 or len(same) != 1:
                times = ', '.join(sorted(entities[row]['data']['startsAt'] for row in rows))
                report.add('calendar-detail-conflict', detail['url'], detail['key'], f'event page starts {detail["data"]["startsAt"]}, month calendar {times}; the calendar entry stays and the event page is kept as a page')
                fallback = detail.get('fallback')
                if fallback:
                    entities['pages:' + fallback['key']] = {'collection': 'pages', 'key': fallback['key'], 'data': fallback['data'], 'relations': {}, 'media': fallback['media'], 'url': detail['url']}
                    for reason, src in fallback['rejected']:
                        report.add(reason, detail['url'], fallback['key'], src)
                    moved[identifier] = 'pages:' + fallback['key']
                continue
            target = same[0]
            event = entities[target]
            if event['data']['title'] != detail['data']['title']:
                report.add('calendar-title-differs', detail['url'], event['key'], f'informational: month calendar {event["data"]["title"]!r}, event page {detail["data"]["title"]!r}; the event page title is used')
            event.update({'data': detail['data'], 'media': detail['media'], 'url': detail['url']})
            moved[identifier] = target
        else:
            target = identifier
            entities[target] = event = detail
        matches = courses.get(unicodedata.normalize('NFC', event['data']['title']), [])
        exact = [course for course in matches if course['data']['nextDate'] == event['data']['startsAt']]
        if len(exact) != 1:
            if matches:
                report.add('event-course-not-linked', event['url'], event['key'], 'informational: same name as a course, but not exactly one course starting at this time')
            continue
        course = exact[0]
        term = hashlib.sha256((course['key'] + '\0' + course['data']['nextDate']).encode()).hexdigest()
        session = 'course-sessions:public-course-start:' + term
        holder = linked.get(session)
        if holder is not None and holder != target and not holder.startswith('events:public-course-calendar:'):
            report.add('event-course-not-linked', event['url'], event['key'], 'informational: the course term is already shown by another calendar entry')
            continue
        event['relations']['courseSession'] = session
        linked[session] = target
        entities.pop('events:public-course-calendar:' + term, None)
    return moved


def resolve_listings(entities, report, follow=lambda route: route):
    """Fills listing pages: members are products found by the exact card address (the product's own
    address, a second address of the same product, or the final address of a captured HTTP redirect),
    in page order; other cards stay as names. The category is the longest imported category in the
    page's address, and only when both pages show the same source category ID; results pages link
    only to captured pages of the same filter."""
    products, categories, listings = {}, {}, {}
    for identifier, entity in entities.items():
        if entity['collection'] == 'products':
            products[route_key(entity['data']['legacyPath'])] = identifier
        elif entity['collection'] == 'categories':
            categories[entity['data']['slug']] = identifier
        elif entity.get('listing') is not None:
            listings[route_key(entity['data']['path'])] = identifier
    for entity in entities.values():
        if entity['collection'] == 'redirects' and entity['requires'].startswith('products:') and entity['requires'] in entities:
            products.setdefault(route_key(entity['data']['from']), entity['requires'])
    for route, identifier in sorted(listings.items()):
        entity = entities[identifier]
        listing, members, missing = entity['listing'], [], []
        for card in listing['cards']:
            route = route_key(card['path']) if card['path'] else None
            target = products.get(route) if route is not None else None
            if target is None and route is not None and follow(route) != route:
                target = products.get(follow(route))
                if target is not None:
                    report.add('listing-card-redirect-resolved', entity['url'], entity['key'], f'informational: {card["path"]} reaches {entities[target]["data"]["legacyPath"]} by a captured HTTP redirect')
            if target is None:
                missing.append({'title': card['title'], **({'legacyPath': card['path']} if card['path'] else {})})
                report.add('listing-product-unresolved', entity['url'], entity['key'], f'{card["title"]} ({card["path"] or "no own-site address"})')
            elif target in members:
                report.add('listing-duplicate-card', entity['url'], entity['key'], card['title'])
            else:
                members.append(target)
                price = entities[target]['data'].get('priceCents')
                if card['priceCents'] is not None and price is not None and card['priceCents'] != price:
                    report.add('listing-price-differs', entity['url'], entity['key'], f'informational: {card["title"]}: card {card["priceCents"]} gr, product page {price} gr; the product is not changed')
        if members:
            entity['relations']['listingProducts'] = members
        if missing:
            entity['data']['listingMissing'] = missing
        segments = stem_of(entity['data']['path']).split('/')
        prefix = next(('/'.join(segments[:end]) for end in range(len(segments) - 1, 0, -1) if '/'.join(segments[:end]) in categories), None)
        if prefix is not None:
            category = entities[categories[prefix]]
            vm_id, shown = category['data'].get('vmId'), listing['ids'][0]
            if vm_id is not None and vm_id == shown:
                entity['relations']['listingCategory'] = categories[prefix]
            elif vm_id is None or shown is None:
                # An address prefix alone is not proof that the list belongs to that category.
                report.add('listing-category-unverified', entity['url'], entity['key'], f'address names {prefix}; category ID {vm_id or "not captured"}, the list shows {shown or "no category ID"}')
            else:
                report.add('listing-category-mismatch', entity['url'], entity['key'], f'address names {prefix} (VirtueMart category {vm_id}), the page searches VirtueMart category {shown}')
    for route, identifier in sorted(listings.items()):
        entity = entities[identifier]
        links, seen = [], {route}
        for link in entity['listing']['pagination']:
            target_route = route_key(link['path'])
            if target_route in seen or target_route not in listings:
                continue
            target = entities[listings[target_route]]
            if None in entity['listing']['ids'] or target['listing']['ids'] != entity['listing']['ids']:
                report.add('listing-link-other-filter', entity['url'], entity['key'], link['path'])
                continue
            seen.add(target_route)
            data = target['data']
            label = f'Wyniki {data["listingFrom"]}–{data["listingTo"]}' if data.get('listingFrom') else link['label']
            if not text_problem(label, 100):
                links.append({'label': label, 'path': data['path']})
        if links:
            entity['data']['listingLinks'] = links


MAX_REDIRECT_HOPS = 20


def plain_own_path(url):
    """Decoded path of a plain own-site URL: no query (not even an empty '?'), fragment, credentials or
    port, and a path the importer accepts unchanged; otherwise None."""
    if not isinstance(url, str) or '?' in url or '#' in url:
        return None
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return None
    if not own_url(parts, port) or port is not None or parts.username is not None or parts.password is not None:
        return None
    return safe_page_path(parts.path or '/')


def captured_redirect_routes(captured, live, report):
    """{source route: final route} of exact HTTP redirects recorded with the authenticated captures
    ({url, final_url}). Only plain own-site addresses; a source answered by several final addresses,
    a source where content was captured itself (live content is never shadowed), chains longer than
    MAX_REDIRECT_HOPS and cycles are reported and not followed. Nothing is inferred from IDs or names."""
    if captured is None:
        return {}
    if not isinstance(captured, list) or len(captured) > MAX_PAGES:
        raise ValueError('captured_redirects must be a list of at most MAX_PAGES capture records.')
    targets = {}
    for row in captured:
        url = row.get('url') if isinstance(row, dict) else None
        final = (row.get('final_url') or url) if isinstance(row, dict) else None
        if not isinstance(url, str) or not isinstance(final, str):
            report.add('captured-redirect-rejected', None, None, 'capture record without a url and final url')
            continue
        if final == url:
            continue
        source, target = plain_own_path(url), plain_own_path(final)
        if source is None or target is None:
            report.add('captured-redirect-rejected', public_url(url), None, 'not a plain own-site address pair (query, fragment, credentials, port, other host or unsafe path)')
            continue
        if route_key(source) != route_key(target):
            targets.setdefault(route_key(source), (source, set()))[1].add(route_key(target))
    hops = {}
    for route, (source, finals) in sorted(targets.items()):
        if len(finals) > 1:
            report.add('captured-redirect-conflict', source, None, 'one address redirected to ' + ' | '.join(sorted(finals)))
        elif route in live:
            report.add('captured-redirect-shadowed', source, None, 'informational: content was captured at this address; it wins and the redirect is not followed')
        else:
            hops[route] = next(iter(finals))
    resolved = {}
    for route in sorted(hops):
        current, seen, end = hops[route], {route}, None
        for _ in range(MAX_REDIRECT_HOPS):
            if current in live or current not in hops:
                end = current
                break
            if current in seen:
                break
            seen.add(current)
            current = hops[current]
        if end is None:
            report.add('captured-redirect-cycle', targets[route][0], None, f'redirect chain loops or exceeds {MAX_REDIRECT_HOPS} hops; not followed')
        else:
            resolved[route] = end
    return resolved


def convert_pages(pages, captured_at, manifest_hash, captured_redirects=None):
    """captured_redirects: optional authenticated capture records [{url, final_url?}] whose exact HTTP
    redirects resolve listing cards and month-calendar event addresses; redirect records themselves are
    added afterwards by captured_redirects.attach_captured_redirects."""
    if not isinstance(manifest_hash, str) or not re.fullmatch(r'[a-f0-9]{64}', manifest_hash):
        raise ValueError('manifest_hash must be a lowercase sha256 hex digest.')
    try:
        datetime.fromisoformat(str(captured_at).replace('Z', '+00:00'))
    except ValueError:
        raise ValueError('captured_at must be an ISO 8601 timestamp.') from None
    report = Report()
    prepared = prepare_pages(pages, report)
    live = {route_key(page['path']) for page in prepared} | set(FIXED_ROUTES) | {'', 'index', 'index.php'}
    redirect_routes = captured_redirect_routes(captured_redirects, live, report)

    def follow(route):
        return redirect_routes.get(route, route)

    observations, parsed = CategoryObservations(), []
    for page in prepared:
        doc = parse_html(page['html'])
        page['base'] = base_of(doc, page['url'])
        page['own'] = own_identity(doc, page)
        harvest_navigation(doc, page, observations)
        parsed.append((page, doc))
    # Listings second: a root-form listing is recognised only once navigation on any page has named it.
    for page, doc in parsed:
        page['listing'] = listing_slug(doc, page, observations)
        harvest_listing(doc, page, observations, report)
    # A captured product page is never a category, whatever links point at its address.
    for page, doc in parsed:
        slug = stem_of(page['path'])
        if slug in observations.data and product_containers(doc):
            report.add('category-link-is-product-page', page['url'], entity_key('category', slug), slug)
            del observations.data[slug]
    categories = resolve_categories(observations, report)
    candidates, converted = [], 0
    for page, doc in parsed:
        candidate = classify(doc, page, report, categories)
        if candidate is None:
            continue
        converted += 1
        if candidate['collection'] == 'products':
            category = next((slug for slug in candidate.pop('categoryCandidates') if slug in categories), None)
            if category is None:
                report.skip('product-category-unresolved', page['url'], candidate['key'])
                continue
            candidate['category'] = category
        candidates.append(candidate)
    merged, redirects = merge_candidates(candidates, report)

    # A captured monthly calendar is authoritative for its explicit source
    # months. Course prose still produces booking sessions, but only supplies
    # a fallback calendar entry outside that coverage. We do not guess that
    # differently named events at the same time represent the same course.
    calendar_rows = [event for page, doc in parsed for event in calendar_events(doc, page, report)]
    calendar_months = set()
    for page, doc in parsed:
        if page['path'] == '/kalendarz.html':
            for day in select(doc, lambda node: node.tag == 'a' and node.has_class('cal_daylink')):
                parts = calendar_day(day, page)
                if parts:
                    calendar_months.add(parts[:2])
    entities = {}
    for slug, category in categories.items():
        relations = {'parent': 'categories:' + categories[category['parent']]['key']} if category['parent'] else {}
        entities['categories:' + category['key']] = {'collection': 'categories', 'key': category['key'], 'data': category['data'], 'relations': relations, 'media': []}
    for candidate in merged:
        relations = {'category': 'categories:' + categories[candidate['category']]['key']} if candidate.get('category') else {}
        entities[f'{candidate["collection"]}:{candidate["key"]}'] = {'collection': candidate['collection'], 'key': candidate['key'], 'data': candidate['data'], 'relations': relations, 'media': candidate['media'],
                                                                     'url': candidate['url'], 'listing': candidate.get('listing'), 'fallback': candidate.get('fallback'), 'sectionLinks': candidate.get('sectionLinks')}
        if candidate['collection'] == 'courses' and candidate['data'].get('nextDate'):
            # A literal, unambiguous source start date is also a calendar term.
            # No quota, price, end date or location is inferred from the prose.
            identifier = hashlib.sha256((candidate['key'] + '\0' + candidate['data']['nextDate']).encode()).hexdigest()
            term = 'public-course-start:' + identifier
            event = 'public-course-calendar:' + identifier
            entities['course-sessions:' + term] = {
                'collection': 'course-sessions', 'key': term,
                'data': {'title': candidate['data']['name'], 'startsAt': candidate['data']['nextDate'], 'published': True},
                'relations': {'course': 'courses:' + candidate['key']}, 'media': [],
            }
            local = datetime.fromisoformat(candidate['data']['nextDate'].replace('Z', '+00:00')).astimezone(ZoneInfo(SITE_ZONE))
            if (local.year, local.month) not in calendar_months:
                entities['events:' + event] = {
                    'collection': 'events', 'key': event,
                    'data': {'title': candidate['data']['name'], 'startsAt': candidate['data']['nextDate'], 'published': True},
                    'relations': {'courseSession': 'course-sessions:' + term}, 'media': [],
                }
    course_paths = {route_key(candidate['path']): candidate for candidate in merged if candidate['collection'] == 'courses'}
    for event in calendar_rows:
        course = course_paths.get(route_key(event['href'])) if event['href'] else None
        relations = {}
        if course and course['data'].get('nextDate') == event['data']['startsAt']:
            identifier = hashlib.sha256((course['key'] + '\0' + course['data']['nextDate']).encode()).hexdigest()
            relations = {'courseSession': 'course-sessions:public-course-start:' + identifier}
        entities['events:' + event['key']] = {'collection': 'events', 'key': event['key'], 'data': event['data'], 'relations': relations, 'media': []}
    # A month cell may name an event page by a redirected address or by a second capture of the same
    # event (merge alias); both resolve to the event page's own route before the rows are matched.
    event_aliases = {route_key(redirect['data']['from']): route_key(redirect['data']['to']) for redirect in redirects if redirect['target'][0] == 'events'}

    def event_route(href):
        route = follow(route_key(href))
        if route != route_key(href):
            report.add('calendar-href-redirect-resolved', None, None, f'informational: month calendar link {href} reaches /{route} by a captured HTTP redirect')
        return event_aliases.get(route, route)

    moved = merge_event_details(entities, calendar_rows, merged, report, event_route)
    for redirect in redirects:
        collection, key = redirect.pop('target')
        entities['redirects:' + redirect['key']] = {**redirect, 'relations': {}, 'requires': moved.get(f'{collection}:{key}', f'{collection}:{key}')}

    # Every public address and unique value may be claimed once (validateBundle); '/x' and '/x.html' are one
    # address. A conflict drops every claimant and is reported, so the rest of the bundle still imports.
    while True:
        claims = {}
        for identifier, entity in entities.items():
            for claim in claims_of(entity):
                claims.setdefault(claim, []).append(identifier)
        dropped = set()
        for claim, owners in sorted(claims.items(), key=lambda item: json.dumps(item[0], ensure_ascii=False)):
            if len(owners) > 1:
                if claim[0] == 'route':
                    paths = sorted({entities[owner]['data'].get('legacyPath') or entities[owner]['data'].get('path') or entities[owner]['data'].get('from') or '' for owner in owners})
                    report.add('conflicting-source-path', None, ', '.join(sorted(owners)), f'address {claim[1]!r}: ' + ' | '.join(paths))
                else:
                    report.add('conflicting-source-value', None, ', '.join(sorted(owners)), f'{claim[0]}.{claim[1]} = {claim[2]}')
                dropped.update(owners)
        for identifier, entity in entities.items():
            references = list(entity['relations'].values()) + ([entity['requires']] if entity.get('requires') else [])
            if any(reference not in entities for reference in references):
                report.add('dependency-dropped', None, identifier, ', '.join(references))
                dropped.add(identifier)
        if not dropped:
            break
        for identifier in dropped:
            entities.pop(identifier, None)
    # Only records that survived the address checks can be list members, categories or link targets.
    resolve_listings(entities, report, follow)
    # The list links a fixed section's source blog did not copy should each be an imported address.
    claimed = {claim[1] for entity in entities.values() for claim in claims_of(entity) if claim[0] == 'route'}
    for entity in entities.values():
        for path in entity.get('sectionLinks') or []:
            if follow(route_key(path)) not in claimed:
                report.add('source-section-teaser-unresolved', entity['url'], entity['key'], f'{path}: listed by the source section, no imported record at this address')

    media = {}
    for identifier in sorted(entities):
        entity = entities[identifier]
        for position, (ref, alt, field) in enumerate(entity['media']):
            item = media.setdefault(ref['path'], {'key': media_key(ref['path']), 'path': ref['path'], 'url': ref['url'], 'alt': '', 'targets': []})
            if ref['url'] != item['url'] and ref['url'] not in item.setdefault('alternateUrls', []):
                item['alternateUrls'].append(ref['url'])  # the same file referenced in another Unicode form
            if alt and (problem := text_problem(alt, 1000)):
                report.add('field-omitted', None, item['key'], f'alt text of {ref["path"]}: {problem}')
            elif not item['alt']:
                item['alt'] = alt
            target = {'collection': entity['collection'], 'key': entity['key'], 'field': field, 'order': position}
            if field == 'photos':
                target['caption'] = alt
            if not any(all(previous[name] == target[name] for name in ('collection', 'key', 'field')) for previous in item['targets']):
                item['targets'].append(target)

    order = ['categories', 'products', 'courses', 'course-sessions', 'pages', 'trips', 'albums', 'events', 'redirects']
    bundle_entities = []
    for identifier in sorted(entities, key=lambda identifier: (order.index(entities[identifier]['collection']), entities[identifier]['key'])):
        entity = entities[identifier]
        row = {'collection': entity['collection'], 'key': entity['key'], 'data': entity['data']}
        if entity['relations']:
            row['relations'] = entity['relations']
        bundle_entities.append(row)
    bundle = {
        'version': 1,
        'source': {'kind': 'public-pages', 'manifestHash': manifest_hash, 'capturedAt': captured_at, 'complete': False},
        'media': [],  # filled by the coordinator after it downloads media_urls and hashes the files
        'entities': bundle_entities,
    }
    source_settings = [footer_settings(doc) for page, doc in parsed if page['path'] == '/' and footer_settings(doc)]
    settings_by_hash = {stable_hash(value): value for value in source_settings}
    if len(settings_by_hash) == 1:
        bundle['settings'] = next(iter(settings_by_hash.values()))
    elif len(settings_by_hash) > 1:
        report.add('conflicting-public-settings', None, None, 'different public company blocks across homepage captures')
    unresolved = report.unresolved()
    counts = {
        'pagesInput': len(pages), 'pagesParsed': len(prepared), 'pagesConverted': converted,
        'skipped': dict(sorted(report.skipped.items())),
        'entities': dict(sorted(Counter(row['collection'] for row in bundle_entities).items())),
        'mediaUrls': len(media), 'unresolved': len(unresolved),
    }
    return {'bundle': bundle, 'media_urls': [media[path] for path in sorted(media)], 'unresolved': unresolved, 'counts': counts}


# ----------------------------------------------------------------------- CLI

def main(argv=None):
    parser = argparse.ArgumentParser(description='Convert decrypted public Underwater page captures (local JSON) into a local import bundle JSON.')
    parser.add_argument('input', help='JSON list of {url, html, sha256, charset?} or {pages, capturedAt, manifestHash}')
    parser.add_argument('output', help='result JSON; written with mode 0600')
    parser.add_argument('--captured-at')
    parser.add_argument('--manifest-hash')
    parser.add_argument('--force', action='store_true', help='overwrite an existing output file')
    args = parser.parse_args(argv)
    for name in (args.input, args.output):
        if any(part.startswith('.env') for part in Path(name).parts):
            parser.error('environment files are not valid input or output')
    if os.path.getsize(args.input) > 1024 * 1024 * 1024:
        parser.error('input exceeds 1 GB')
    with open(args.input, encoding='utf-8') as handle:
        payload = json.load(handle)
    pages = payload.get('pages') if isinstance(payload, dict) else payload
    captured_at = args.captured_at or (payload.get('capturedAt') if isinstance(payload, dict) else None)
    manifest_hash = args.manifest_hash or (payload.get('manifestHash') if isinstance(payload, dict) else None)
    result = convert_pages(pages, captured_at, manifest_hash)
    flags = os.O_WRONLY | os.O_CREAT | (os.O_TRUNC if args.force else os.O_EXCL)
    with os.fdopen(os.open(args.output, flags, 0o600), 'w', encoding='utf-8') as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write('\n')
    print(json.dumps({'output': args.output, 'counts': result['counts']}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        print(json.dumps({'error': type(error).__name__, 'message': str(error)}), file=sys.stderr)
        raise SystemExit(1)
