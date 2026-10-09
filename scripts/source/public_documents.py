"""Acquire only inventoried public same-host PDF links, preserving encrypted originals.

This reads no source configuration or database and performs GET only. Downloads
are never executed. Unavailable, encrypted or active documents remain review items.
"""
import contextlib
import hashlib
import io
import json
import logging
import os
from pathlib import Path
import time
from urllib.parse import quote, unquote, urlsplit

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from pypdf import PdfReader

from inventory import decrypt_manifest, encrypted_write
from keychain import snapshot_key, security
from public_capture import get, public_url_scope

PRIVATE = Path.home() / 'Programo/underwater-private'
FORBIDDEN = {'/JavaScript', '/JS', '/EmbeddedFiles', '/EF', '/XFA', '/RichMedia', '/AA'}
ACTIVE_ACTIONS = {'/JavaScript', '/Launch', '/GoToR', '/GoToE', '/SubmitForm', '/ImportData', '/Rendition', '/Sound', '/Movie'}


def verify_pdf(body):
    if not body.startswith(b'%PDF-') or b'%%EOF' not in body[-4096:] or len(body) > 8 * 1024 * 1024:
        raise ValueError('Invalid bounded PDF.')
    # No PDF script, viewer, extraction command or external action is executed.
    with contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
        reader = PdfReader(io.BytesIO(body), strict=True)
        if reader.is_encrypted: raise ValueError('Encrypted PDF requires source review.')
        if not 1 <= len(reader.pages) <= 1000: raise ValueError('PDF page count exceeds the preview bound.')
        objects = sum(len(group) for group in reader.xref.values()) + len(reader.xref_objStm)
        if objects > 50000: raise ValueError('PDF object count exceeds the preview bound.')
        visited = set()
        pending = [reader.trailer]
        while pending:
            value = pending.pop()
            if hasattr(value, 'idnum') and hasattr(value, 'generation'):
                identity = (value.idnum, value.generation)
                if identity in visited: continue
                visited.add(identity)
                if len(visited) > 50000: raise ValueError('PDF reference graph exceeds the preview bound.')
                pending.append(value.get_object())
            elif isinstance(value, dict):
                action = value.get('/S')
                if hasattr(action, 'get_object'): action = action.get_object()
                subtype = value.get('/Subtype')
                if hasattr(subtype, 'get_object'): subtype = subtype.get_object()
                if FORBIDDEN.intersection(str(key) for key in value) or str(action) in ACTIVE_ACTIONS or str(subtype) in {'/RichMedia', '/3D', '/Screen', '/Movie', '/Sound'}:
                    raise ValueError('Active PDF requires source review.')
                pending.extend(value.values())
            elif isinstance(value, (list, tuple)):
                pending.extend(value)
        return len(reader.pages)


def main():
    security().SecKeychainSetUserInteractionAllowed(False)
    logging.getLogger('pypdf').setLevel(logging.CRITICAL)
    key = snapshot_key()
    inventory = json.loads((PRIVATE / '20261008-public/public-documents-inventory.json').read_text())
    output = PRIVATE / '20261008-public-documents'
    output.mkdir(mode=0o700, exist_ok=True); os.chmod(output, 0o700)
    files = output / 'files'; archive = output / 'objects'
    files.mkdir(mode=0o700, exist_ok=True); archive.mkdir(mode=0o700, exist_ok=True)
    manifest_path = output / 'documents-manifest.enc'
    manifest = decrypt_manifest(manifest_path, key) if manifest_path.exists() else {'files': [], 'failed': [], 'databaseSnapshot': False}
    by_url = {row['url']: row for row in manifest['files']}
    failed_by_url = {row['url']: row for row in manifest['failed']}
    for entry in inventory['documents']:
        url = entry['url']; parts = urlsplit(url)
        if not public_url_scope(url) or Path(unquote(parts.path)).suffix.lower() != '.pdf' or any(part.startswith('.env') for part in unquote(parts.path).split('/')):
            raise PermissionError('Inventoried PDF left authorized public scope.')
        previous = by_url.get(url)
        if previous:
            target = files / previous['path']
            if target.is_symlink() or not target.resolve().is_relative_to(files.resolve()) or hashlib.sha256(target.read_bytes()).hexdigest() != previous['sha256']:
                raise ValueError('Existing PDF checkpoint changed; original preserved for review.')
            continue
        # A local URL-encoding failure is safe to repair. Do not retry source
        # authorization/WAF/HTTP failures by changing endpoints or credentials.
        if url in failed_by_url and failed_by_url[url]['errorType'] != 'UnicodeEncodeError': continue
        try:
            body, final, _ = get(parts._replace(path=quote(parts.path, safe='/%')).geturl())
            if not public_url_scope(final) or Path(unquote(urlsplit(final).path)).suffix.lower() != '.pdf': raise PermissionError('PDF response left public document scope.')
            digest = hashlib.sha256(body).hexdigest()
            object_name = hashlib.sha256((url + '\0' + digest).encode()).hexdigest() + '.enc'
            encrypted = archive / object_name
            if not encrypted.exists():
                nonce = os.urandom(12)
                with encrypted.open('xb') as stream: stream.write(b'UWENC1' + nonce + AESGCM(key).encrypt(nonce, body, url.encode()))
                os.chmod(encrypted, 0o600)
            pages = verify_pdf(body)
            filename = digest + '.pdf'
            target = files / filename
            if target.exists():
                if target.is_symlink() or hashlib.sha256(target.read_bytes()).hexdigest() != digest: raise ValueError('Existing PDF bytes were preserved.')
            else:
                with target.open('xb') as stream: stream.write(body)
                os.chmod(target, 0o600)
            row = {'key': 'public-pdf-' + hashlib.sha256(url.encode()).hexdigest(), 'path': filename, 'sha256': digest, 'url': url, 'title': Path(unquote(parts.path)).name, 'pages': pages, 'bytes': len(body)}
            manifest['files'].append(row); by_url[url] = row
            manifest['failed'] = [row for row in manifest['failed'] if row['url'] != url]
        except Exception as error:
            manifest['failed'] = [row for row in manifest['failed'] if row['url'] != url] + [{'url': url, 'errorType': type(error).__name__}]
        encrypted_write(manifest_path, manifest, key)
        print(json.dumps({'documentsReady': len(manifest['files']), 'documentsFailed': len(manifest['failed']), 'clientWrites': False}), flush=True)
        time.sleep(0.7)


if __name__ == '__main__': main()
