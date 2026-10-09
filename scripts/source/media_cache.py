"""Collision-free public-image staging, restored from the authenticated archive.

Every media key owns images/<sha256(key)>.<ext>, so same or case-colliding
source names never share a staging file. Cached bytes come from a verified
earlier staging path or the immutable AES-GCM archive object; never from a GET.
Existing files are never overwritten, renamed or deleted.
"""
import hashlib
import json
import os
import re
import stat
from pathlib import Path, PurePosixPath

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from inventory import encrypted_write
from public_media_fetch import prefetch

MAX_BYTES = 12 * 1024 * 1024
HEADER = b'UWENC1'
EXTENSION = re.compile(r'\.(?:jpe?g|png|webp|gif|avif)$')
HEX = re.compile(r'[0-9a-f]{64}')
CHECKPOINT = 500


class CacheIntegrityError(ValueError):
    """Authenticated cache evidence does not match its descriptor; preserved for review."""


class CacheConflict(ValueError):
    """A different file already occupies the unique staging path; preserved for review."""


def unique_path(key, source_path):
    extension = PurePosixPath(source_path).suffix.lower()
    if not isinstance(key, str) or not key or not EXTENSION.fullmatch(extension):
        raise ValueError('Unsupported public media key or extension.')
    return 'images/' + hashlib.sha256(key.encode('utf-8')).hexdigest() + extension


def safe_relative(path):
    relative = PurePosixPath(path) if isinstance(path, str) else None
    if relative is None or relative.is_absolute() or not relative.parts or '\\' in path or any(
        part in {'', '.', '..'} or part.startswith('.') or any(c in part for c in '\0\r\n') for part in relative.parts
    ):
        raise ValueError('Unsafe public media path.')
    return relative


def archive_object(archive, url, digest):
    return Path(archive) / (hashlib.sha256((url + '\0' + digest).encode()).hexdigest() + '.enc')


def _regular(root, relative, limit):
    """Return an O_NOFOLLOW descriptor for root/relative or None when absent.

    Every component is lstat-checked, so a symlinked directory or file is
    refused instead of followed; the realpath must stay inside root.
    """
    root = Path(os.path.realpath(root))
    current = root
    for index, part in enumerate(relative.parts):
        current = current / part
        try:
            info = os.lstat(current)
        except FileNotFoundError:
            return None
        if stat.S_ISLNK(info.st_mode):
            raise CacheIntegrityError('Staging symlink was preserved and not followed.')
        last = index == len(relative.parts) - 1
        if not (stat.S_ISREG(info.st_mode) if last else stat.S_ISDIR(info.st_mode)):
            raise CacheIntegrityError('Unexpected staging entry was preserved.')
    if not Path(os.path.realpath(current)).is_relative_to(root):
        raise CacheIntegrityError('Media staging path escaped.')
    if info.st_size > limit:
        raise CacheIntegrityError('Cached media exceeds the size limit.')
    fd = os.open(current, os.O_RDONLY | os.O_NOFOLLOW)
    opened = os.fstat(fd)
    if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
        os.close(fd)
        raise CacheIntegrityError('Staging entry changed while it was checked.')
    return fd


def _read(fd, limit):
    with os.fdopen(fd, 'rb') as stream:
        body = stream.read(limit + 1)
    if len(body) > limit:
        raise CacheIntegrityError('Cached media exceeds the size limit.')
    return body


def read_staged(media_root, path):
    """Bytes of a staged file, or None when absent. Symlinks and escapes are refused."""
    fd = _regular(media_root, safe_relative(path), MAX_BYTES)
    return None if fd is None else _read(fd, MAX_BYTES)


def read_archive(archive, aes_key, url, digest):
    """Exact authenticated bytes for (url, sha256), or None when the object is absent."""
    target = archive_object(archive, url, digest)
    fd = _regular(target.parent, PurePosixPath(target.name), len(HEADER) + 12 + MAX_BYTES + 16)
    if fd is None:
        return None
    blob = _read(fd, len(HEADER) + 12 + MAX_BYTES + 16)
    if blob[:6] != HEADER:
        raise CacheIntegrityError('Unrecognized encrypted media object.')
    try:
        body = AESGCM(aes_key).decrypt(blob[6:18], blob[18:], url.encode())
    except InvalidTag:
        raise CacheIntegrityError('Encrypted media object failed authentication.') from None
    if len(body) > MAX_BYTES or hashlib.sha256(body).hexdigest() != digest:
        raise CacheIntegrityError('Encrypted media object does not match its descriptor.')
    return body


def write_archive(archive, aes_key, url, digest, body):
    """Create the immutable object once; an existing one must decrypt to the same bytes."""
    if read_archive(archive, aes_key, url, digest) is not None:
        return
    nonce = os.urandom(12)
    fd = os.open(archive_object(archive, url, digest), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(HEADER + nonce + AESGCM(aes_key).encrypt(nonce, body, url.encode()))
        stream.flush(); os.fsync(stream.fileno())


def place(media_root, path, body, digest):
    """Create media_root/path with exactly body; identical existing bytes are accepted."""
    relative = safe_relative(path)
    if hashlib.sha256(body).hexdigest() != digest or len(body) > MAX_BYTES:
        raise CacheIntegrityError('Media bytes do not match their descriptor.')
    existing = read_staged(media_root, path)
    if existing is not None:
        if hashlib.sha256(existing).hexdigest() != digest:
            raise CacheConflict('A different staged file was preserved at the unique path.')
        return
    parent = Path(os.path.realpath(media_root))
    for part in relative.parts[:-1]:
        parent = parent / part
        try:
            os.mkdir(parent, 0o700)
        except FileExistsError:
            pass
        if not stat.S_ISDIR(os.lstat(parent).st_mode):
            raise CacheIntegrityError('Staging directory was replaced; preserved for review.')
    final = parent / relative.name
    # Write a private temporary file and link it: a crash never leaves a partial
    # file under the unique name and link() refuses to replace an existing file.
    part = parent / ('.' + relative.name + '.part-' + os.urandom(6).hex())
    fd = os.open(part, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(body); stream.flush(); os.fchmod(stream.fileno(), 0o600); os.fsync(stream.fileno())
        os.link(part, final)
    except FileExistsError:
        raced = read_staged(media_root, path)
        if raced is None or hashlib.sha256(raced).hexdigest() != digest:
            raise CacheConflict('A different staged file was preserved at the unique path.') from None
    finally:
        os.unlink(part)


def restore(row, previous, media_root, archive, aes_key):
    """Verified descriptor at the row's unique path, or None when no captured bytes exist."""
    if previous is None:
        return None
    digest, url = previous.get('sha256'), previous.get('url')
    if previous.get('key') != row['key'] or not isinstance(digest, str) or not HEX.fullmatch(digest) or not isinstance(url, str):
        raise CacheIntegrityError('Invalid acquired media descriptor.')
    path = unique_path(row['key'], row['path'])
    existing = read_staged(media_root, path)
    if existing is not None:
        if hashlib.sha256(existing).hexdigest() != digest:
            raise CacheConflict('A different staged file was preserved at the unique path.')
        return {**previous, 'path': path}
    body = None
    try:
        body = read_staged(media_root, previous['path'])
    except (ValueError, KeyError):
        body = None  # an unsafe legacy path is never read; the archive is authoritative
    if body is None or hashlib.sha256(body).hexdigest() != digest:
        # Legacy shared paths may hold a colliding key's bytes; never trust them.
        body = read_archive(archive, aes_key, url, digest)
    if body is None:
        return None
    place(media_root, path, body, digest)
    return {**previous, 'path': path}


def acquire(rows, acquired, manifest_path, media_root, archive, aes_key, cached_only=False, skip_known_failures=False, fetcher=None):
    """Stage every media row; return bundle descriptors in source order.

    Restored rows update the manifest in bounded checkpoints, downloads at once
    (their bytes cost a request). Known failures are kept unchanged in replay
    modes. One cached body is held at a time; prefetch bounds downloads.
    """
    files = {row['key']: row for row in acquired['files']}
    failed = {row['key']: row for row in acquired['failed']}
    blocked = {key for key, row in failed.items() if row.get('error_type') != 'FileNotFoundError'} if skip_known_failures else set()
    pending = 0

    def flush():
        nonlocal pending
        if pending:
            acquired['files'], acquired['failed'] = list(files.values()), list(failed.values())
            encrypted_write(manifest_path, acquired, aes_key)
            pending = 0

    def cached(row):
        nonlocal pending
        previous = files.get(row['key'])
        descriptor = restore(row, previous, media_root, archive, aes_key)
        if descriptor is not None and descriptor != previous:
            files[row['key']] = descriptor
            pending += 1
            if pending >= CHECKPOINT:
                flush()
        return descriptor

    media = []
    options = {} if fetcher is None else {'fetcher': fetcher}
    try:
        for index, row, previous, body, download_error in prefetch(rows, cached, cached_only=cached_only, blocked_keys=blocked, **options):
            if previous:
                descriptor = {**previous, 'alt': row['alt']}
            else:
                try:
                    if download_error: raise download_error
                    if body is None: raise ValueError('Public image download returned no bytes.')
                    if len(body) > MAX_BYTES: raise ValueError('Invalid public image response.')
                    descriptor = {'key': row['key'], 'path': unique_path(row['key'], row['path']), 'sha256': hashlib.sha256(body).hexdigest(), 'alt': row['alt'], 'url': row['url']}
                    # Each source version gets its own immutable encrypted object.
                    write_archive(archive, aes_key, row['url'], descriptor['sha256'], body)
                    place(media_root, descriptor['path'], body, descriptor['sha256'])
                    files.pop(row['key'], None); files[row['key']] = descriptor
                    failed.pop(row['key'], None)
                    pending += 1
                    flush()
                except Exception as error:
                    if (not cached_only and row['key'] not in blocked) or row['key'] not in failed:
                        failed.pop(row['key'], None); failed[row['key']] = {'key': row['key'], 'error_type': type(error).__name__}
                        pending += 1
                    continue
            media.append(descriptor)
            if index % 50 == 0:
                print(json.dumps({'media_processed': index + 1, 'media_ready': len(media), 'failures': len(failed)}), flush=True)
    finally:
        # Only verified, fsynced files are ever recorded, so a partial run stays consistent.
        flush()
    return media
