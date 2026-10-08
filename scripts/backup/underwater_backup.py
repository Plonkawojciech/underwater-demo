#!/usr/bin/env python3
"""Encrypted backup and verified restore of the isolated Underwater SQLite database and media.

    backup  --data-root /abs/root --environment preview|test --destination /abs/new-dir
    restore --archive /abs/file.uwbak --destination /abs/new-empty-root

The 32-byte AES-256-GCM key arrives only on stdin as JSON {"key": "<base64>"}. It is never
accepted from arguments, files or the environment, and never printed.

Archive layout: MAGIC | u32 header length | header JSON | ciphertext | 16-byte GCM tag.
The plaintext is a tar stream (database snapshot, media files, MANIFEST.json last). The
magic and header are authenticated as associated data. Restore authenticates the whole
ciphertext into a private spool file before any tar member is read.
"""
import argparse
import base64
import binascii
import datetime
import hashlib
import io
import json
import os
import secrets
import shutil
import sqlite3
import stat
import struct
import sys
import tarfile
import tempfile
import unicodedata
import urllib.parse

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

FORMAT = "underwater-backup"
FORMAT_VERSION = 1
TOOL_VERSION = "1.0.0"
MAGIC = b"UWBAK\x00\x01\n"
CIPHER = "AES-256-GCM"
ENVIRONMENTS = ("preview", "test")
MANIFEST_NAME = "MANIFEST.json"
CHUNK = 1 << 20
TAG_BYTES = 16
NONCE_BYTES = 12
MAX_HEADER = 4096
MAX_KEY_INPUT = 4096
MAX_MANIFEST = 64 << 20
# One nonce may protect at most ~64 GiB under GCM; stay well below it.
GCM_MAX_PLAINTEXT = 32 << 30
TAR_OVERHEAD = 64 << 20
DEFAULT_RESERVE = 1 << 30
DEFAULT_MAX_TOTAL = 16 << 30
DEFAULT_MAX_FILE = 4 << 30
DEFAULT_MAX_MEMBERS = 200_000


class Refused(Exception):
    """A safety rule failed. Nothing partial is left behind and nothing is claimed complete."""


# --- paths -----------------------------------------------------------------------------

def checked_path(raw, label):
    if not raw or "\x00" in raw or not os.path.isabs(raw):
        raise Refused(f"{label} must be an absolute path.")
    if raw == "/" or os.path.normpath(raw) != raw:
        raise Refused(f"{label} must be a normalized path without '.', '..' or trailing separators.")
    if os.path.realpath(raw) != raw:
        raise Refused(f"{label} must not pass through a symlink.")
    return raw


def inside(child, parent):
    return child == parent or child.startswith(parent + "/")


def real_dir(path, label):
    try:
        st = os.lstat(path)
    except FileNotFoundError:
        raise Refused(f"{label} is missing.") from None
    if not stat.S_ISDIR(st.st_mode):
        raise Refused(f"{label} must be a real directory, not a symlink or another file type.")
    return st


def real_file(path, label, single_link=True):
    try:
        st = os.lstat(path)
    except FileNotFoundError:
        raise Refused(f"{label} is missing.") from None
    if not stat.S_ISREG(st.st_mode):
        raise Refused(f"{label} must be a regular file, not a symlink or another file type.")
    if single_link and st.st_nlink != 1:
        raise Refused(f"{label} has hard links; refusing to copy shared content.")
    return st


def identity(st):
    return (st.st_dev, st.st_ino, st.st_mode, st.st_nlink, st.st_size, st.st_mtime_ns, st.st_ctime_ns)


def fsync_dir(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def free_bytes(path):
    return shutil.disk_usage(path).free


def collision_key(name):
    # APFS and many other file systems treat case and Unicode normalization as equal.
    return unicodedata.normalize("NFC", name).casefold()


def checked_component(name, where):
    try:
        name.encode("utf-8")
    except UnicodeEncodeError:
        raise Refused(f"{where} has a name that is not valid UTF-8.") from None
    if name in ("", ".", "..") or "/" in name or "\\" in name:
        raise Refused(f"{where} has an unsafe name.")
    if any(ord(char) < 32 or ord(char) == 127 for char in name):
        raise Refused(f"{where} has a name with control characters.")
    return name


def quoted_uri(path, query):
    return "file:" + urllib.parse.quote(path) + "?" + query


# --- key and sealed stream -------------------------------------------------------------

def read_key(stream):
    raw = stream.read(MAX_KEY_INPUT + 1)
    if len(raw) > MAX_KEY_INPUT:
        raise Refused("stdin key payload is too large.")
    try:
        payload = json.loads(raw)
        if not isinstance(payload, dict) or set(payload) != {"key"} or not isinstance(payload["key"], str):
            raise ValueError
        key = base64.b64decode(payload["key"], validate=True)
    except (ValueError, binascii.Error):
        raise Refused('stdin must carry JSON {"key": "<base64 of 32 bytes>"}.') from None
    if len(key) != 32:
        raise Refused("the key must be exactly 32 bytes (AES-256).")
    return key


def encode_header(header):
    encoded = json.dumps(header, sort_keys=True, separators=(",", ":")).encode()
    if len(encoded) > MAX_HEADER:
        raise Refused("archive header is too large.")
    return MAGIC + struct.pack(">I", len(encoded)) + encoded


class SealedWriter:
    """File-like sink: everything written is AES-256-GCM encrypted into `out`."""

    def __init__(self, out, key, header):
        nonce = secrets.token_bytes(NONCE_BYTES)
        prefix = encode_header(dict(header, cipher=CIPHER, nonce=base64.b64encode(nonce).decode()))
        self._encryptor = Cipher(algorithms.AES(key), modes.GCM(nonce)).encryptor()
        self._encryptor.authenticate_additional_data(prefix)
        self._out = out
        self._digest = hashlib.sha256()
        self.plaintext_bytes = 0
        self._emit(prefix)

    def _emit(self, data):
        self._out.write(data)
        self._digest.update(data)

    def write(self, data):
        self.plaintext_bytes += len(data)
        if self.plaintext_bytes > GCM_MAX_PLAINTEXT:
            raise Refused("backup exceeds the size one GCM nonce may safely protect.")
        self._emit(self._encryptor.update(bytes(data)))
        return len(data)

    def finish(self):
        self._emit(self._encryptor.finalize())
        self._emit(self._encryptor.tag)
        return self._digest.hexdigest()


def read_header(handle):
    magic = handle.read(len(MAGIC))
    if magic != MAGIC:
        raise Refused("not an Underwater backup archive (unknown magic).")
    size = handle.read(4)
    if len(size) != 4:
        raise Refused("archive header is truncated.")
    (length,) = struct.unpack(">I", size)
    if length > MAX_HEADER:
        raise Refused("archive header is too large.")
    encoded = handle.read(length)
    if len(encoded) != length:
        raise Refused("archive header is truncated.")
    try:
        header = json.loads(encoded)
        nonce = base64.b64decode(header["nonce"], validate=True)
    except (ValueError, KeyError, TypeError, binascii.Error):
        raise Refused("archive header is malformed.") from None
    if (header.get("format") != FORMAT or header.get("format_version") != FORMAT_VERSION
            or header.get("cipher") != CIPHER or header.get("environment") not in ENVIRONMENTS
            or not isinstance(header.get("created_at"), str) or len(nonce) != NONCE_BYTES):
        raise Refused("archive header has an unsupported format, cipher or environment.")
    return header, nonce, MAGIC + struct.pack(">I", length) + encoded


# --- backup ----------------------------------------------------------------------------

def scan_media(media_root):
    """Every regular file under media, sorted. Anything unsafe fails the whole backup."""
    found = []
    seen = set()

    def walk(directory, relative):
        with os.scandir(directory) as entries:
            children = sorted(entries, key=lambda entry: entry.name)
        for entry in children:
            where = "media/" + "/".join(relative + [entry.name])
            checked_component(entry.name, where)
            if entry.name.startswith(".env"):
                raise Refused(f"{where} looks like an environment file; refusing to archive it.")
            st = entry.stat(follow_symlinks=False)
            key = collision_key(where)
            if key in seen:
                raise Refused(f"{where} collides with another media name on case-insensitive restore.")
            seen.add(key)
            if stat.S_ISLNK(st.st_mode):
                raise Refused(f"{where} is a symlink; media must contain only real files.")
            if stat.S_ISDIR(st.st_mode):
                walk(entry.path, relative + [entry.name])
            elif stat.S_ISREG(st.st_mode):
                if st.st_nlink != 1:
                    raise Refused(f"{where} has hard links; refusing to copy shared content.")
                found.append((where, entry.path, st))
            else:
                raise Refused(f"{where} is a special file; media must contain only real files.")

    walk(media_root, [])
    return found


class HashingReader:
    def __init__(self, raw, limit):
        self._raw = raw
        self._remaining = limit
        self.digest = hashlib.sha256()
        self.count = 0

    def read(self, size=-1):
        if size is None or size < 0 or size > self._remaining:
            size = self._remaining
        data = self._raw.read(size)
        self._remaining -= len(data)
        self.count += len(data)
        self.digest.update(data)
        return data


def tar_info(name, size, mtime):
    info = tarfile.TarInfo(name)
    info.type = tarfile.REGTYPE
    info.size = size
    info.mode = 0o600
    info.mtime = int(mtime)
    info.uid = info.gid = 0
    info.uname = info.gname = ""
    return info


def add_file(tar, path, name, expected):
    """Stream one file into the tar; refuse if it is not exactly the file that was scanned."""
    changed = f"{name} changed during the backup; nothing was claimed complete."
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        if expected is not None and identity(before) != identity(expected):
            raise Refused(changed)
        with os.fdopen(fd, "rb", closefd=False) as raw:
            reader = HashingReader(raw, before.st_size)
            try:
                tar.addfile(tar_info(name, before.st_size, before.st_mtime), reader)
            except OSError as error:
                if str(error) == "unexpected end of data":
                    raise Refused(changed) from None
                raise
            if reader.count != before.st_size or raw.read(1):
                raise Refused(changed)
        if identity(os.fstat(fd)) != identity(before) or identity(os.lstat(path)) != identity(before):
            raise Refused(changed)
    finally:
        os.close(fd)
    return {"path": name, "size": before.st_size, "sha256": reader.digest.hexdigest()}


def database_stats(connection):
    tables = [row[0] for row in connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    rows = 0
    for table in tables:
        rows += connection.execute('SELECT count(*) FROM "' + table.replace('"', '""') + '"').fetchone()[0]
    migration = None
    if "payload_migrations" in tables:
        found = connection.execute("SELECT name FROM payload_migrations ORDER BY id DESC LIMIT 1").fetchone()
        migration = found[0] if found else None
    return {"tables": len(tables), "rows": rows, "latest_migration": migration}


def integrity(connection):
    result = [row[0] for row in connection.execute("PRAGMA integrity_check")]
    return "ok" if result == ["ok"] else "failed"


def snapshot_database(database, snapshot):
    """Consistent snapshot of a live WAL database via the SQLite online backup API."""
    source = sqlite3.connect(quoted_uri(database, "mode=ro"), uri=True)
    try:
        journal_mode = source.execute("PRAGMA journal_mode").fetchone()[0]
        target = sqlite3.connect(snapshot)
        try:
            source.backup(target)
            # A single self-contained file in the archive; the app re-enables WAL on open.
            target.execute("PRAGMA journal_mode=DELETE")
            if integrity(target) != "ok":
                raise Refused("the database snapshot failed PRAGMA integrity_check.")
            stats = database_stats(target)
        finally:
            target.close()
    finally:
        source.close()
    os.chmod(snapshot, 0o600)
    return dict(stats, source_journal_mode=journal_mode, sqlite_version=sqlite3.sqlite_version)


def backup(args, key):
    environment = args.environment
    root = checked_path(args.data_root, "--data-root")
    destination = checked_path(args.destination, "--destination")
    if inside(destination, root) or inside(root, destination):
        raise Refused("--destination and --data-root must not contain each other.")
    real_dir(root, "data root")
    db_name = f"underwater-{environment}.db"
    database = os.path.join(root, db_name)
    estimate = real_file(database, "database " + db_name).st_size
    for suffix in ("-wal", "-shm", "-journal"):
        if os.path.lexists(database + suffix):
            estimate += real_file(database + suffix, "database " + db_name + suffix).st_size
    media_root = os.path.join(root, "media")
    real_dir(media_root, "media directory")
    media = scan_media(media_root)
    estimate += sum(st.st_size for _, _, st in media)

    created = False
    parent = os.path.dirname(destination)
    real_dir(parent, "--destination parent")
    try:
        os.mkdir(destination, 0o700)
        created = True
    except FileExistsError:
        st = real_dir(destination, "--destination")
        if st.st_uid != os.geteuid() or os.listdir(destination):
            raise Refused("--destination already has content or another owner; use a new directory.") from None
        os.chmod(destination, 0o700)

    work = partial = None
    complete = False
    try:
        needed = 2 * estimate + TAR_OVERHEAD + args.min_free_bytes
        if free_bytes(destination) < needed:
            raise Refused(f"not enough free disk space: need {needed} bytes including the reserve.")
        work = tempfile.mkdtemp(prefix=".work-", dir=destination)
        snapshot = os.path.join(work, "snapshot.db")
        database_info = snapshot_database(database, snapshot)

        created_at = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)
        stamp = created_at.isoformat().replace("+00:00", "Z")
        name = f"underwater-{environment}-{created_at:%Y%m%dT%H%M%SZ}.uwbak"
        final = os.path.join(destination, name)
        partial = os.path.join(destination, "." + name + ".partial")
        header = {"format": FORMAT, "format_version": FORMAT_VERSION, "tool_version": TOOL_VERSION,
                  "environment": environment, "created_at": stamp}
        fd = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as out:
            writer = SealedWriter(out, key, header)
            with tarfile.open(fileobj=writer, mode="w|", format=tarfile.PAX_FORMAT) as tar:
                db_entry = add_file(tar, snapshot, db_name, None)
                entries = [add_file(tar, path, where, st) for where, path, st in media]
                if [(where, identity(st)) for where, _, st in scan_media(media_root)] != \
                        [(where, identity(st)) for where, _, st in media]:
                    raise Refused("media changed during the backup; nothing was claimed complete.")
                manifest = dict(header, database=dict(db_entry, **database_info), media=entries,
                                totals={"files": len(entries) + 1,
                                        "bytes": db_entry["size"] + sum(e["size"] for e in entries)})
                encoded = json.dumps(manifest, indent=1, sort_keys=True).encode()
                tar.addfile(tar_info(MANIFEST_NAME, len(encoded), created_at.timestamp()), io.BytesIO(encoded))
            archive_sha256 = writer.finish()
            out.flush()
            os.fsync(out.fileno())
        os.rename(partial, final)
        fsync_dir(destination)
        complete = True
    finally:
        # Remove only what this run created; never touch anything else in the destination.
        if work:
            shutil.rmtree(work)
        if not complete:
            if partial and os.path.lexists(partial):
                os.unlink(partial)
            if created and not os.listdir(destination):
                os.rmdir(destination)

    return {
        "status": "complete", "operation": "backup", "environment": environment, "created_at": stamp,
        "archive": final, "archive_bytes": os.lstat(final).st_size, "archive_sha256": archive_sha256,
        "database": {"integrity": "ok", "bytes": db_entry["size"], "tables": database_info["tables"],
                     "rows": database_info["rows"], "latest_migration": database_info["latest_migration"]},
        "media": {"files": len(entries), "bytes": sum(e["size"] for e in entries)},
    }


# --- restore ---------------------------------------------------------------------------

def decrypt_to_spool(handle, key, nonce, prefix, length, spool):
    handle.seek(len(prefix) + length)
    tag = handle.read(TAG_BYTES)
    handle.seek(len(prefix))
    decryptor = Cipher(algorithms.AES(key), modes.GCM(nonce, tag)).decryptor()
    decryptor.authenticate_additional_data(prefix)
    fd = os.open(spool, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as out:
        remaining = length
        while remaining:
            chunk = handle.read(min(CHUNK, remaining))
            if not chunk:
                raise Refused("archive is truncated.")
            remaining -= len(chunk)
            out.write(decryptor.update(chunk))
        try:
            out.write(decryptor.finalize())
        except InvalidTag:
            raise Refused("authentication failed (wrong key or modified archive); nothing was extracted.") from None
        out.flush()
        os.fsync(out.fileno())


def checked_member_name(name, db_name):
    if not isinstance(name, str) or not name or len(name) > 4096 or name.startswith("/"):
        raise Refused("archive member has an absolute or empty path.")
    parts = name.split("/")
    for part in parts:
        checked_component(part, "archive member")
    if name in (db_name, MANIFEST_NAME):
        return parts
    if len(parts) >= 2 and parts[0] == "media":
        return parts
    raise Refused("archive member is outside the database, media and manifest.")


def read_members(tar, db_name, limits):
    members, seen, total = [], set(), 0
    while True:
        member = tar.next()
        if member is None:
            break
        if len(members) >= limits["members"]:
            raise Refused("archive has too many members.")
        checked_member_name(member.name, db_name)
        if member.type not in (tarfile.REGTYPE, tarfile.AREGTYPE):
            raise Refused("archive contains a link, directory or special member; only regular files are allowed.")
        key = collision_key(member.name)
        if key in seen:
            raise Refused("archive contains duplicate members.")
        seen.add(key)
        if member.size > limits["file"]:
            raise Refused("archive member exceeds the per-file quota.")
        total += member.size
        if total > limits["total"]:
            raise Refused("archive exceeds the total size quota.")
        members.append(member)
    return members


def load_manifest(tar, members, header, db_name):
    if not members or members[-1].name != MANIFEST_NAME or members[-1].size > MAX_MANIFEST:
        raise Refused("archive manifest is missing or misplaced.")
    try:
        manifest = json.loads(tar.extractfile(members[-1]).read())
        expected = [manifest["database"]] + list(manifest["media"])
        listed = {entry["path"]: (int(entry["size"]), str(entry["sha256"])) for entry in expected}
    except (ValueError, KeyError, TypeError):
        raise Refused("archive manifest is malformed.") from None
    for field in ("format", "format_version", "environment", "created_at"):
        if manifest.get(field) != header.get(field):
            raise Refused("archive manifest does not match the authenticated header.")
    if manifest["database"]["path"] != db_name or len(listed) != len(expected):
        raise Refused("archive manifest lists an unexpected database or duplicate files.")
    if sorted(m.name for m in members[:-1]) != sorted(listed):
        raise Refused("archive members do not match the manifest (unlisted or missing files).")
    return manifest, listed


def write_member(tar, member, clone, size, sha256):
    parts = member.name.split("/")
    directory = clone
    for part in parts[:-1]:
        directory = os.path.join(directory, part)
        try:
            os.mkdir(directory, 0o700)
        except FileExistsError:
            real_dir(directory, "restored directory")
    target = os.path.join(directory, parts[-1])
    if member.size != size:
        raise Refused("archive member size does not match the manifest.")
    source = tar.extractfile(member)
    digest, written = hashlib.sha256(), 0
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as out:
        while True:
            chunk = source.read(CHUNK)
            if not chunk:
                break
            written += len(chunk)
            if written > size:
                raise Refused("archive member is larger than the manifest says.")
            digest.update(chunk)
            out.write(chunk)
        out.flush()
        os.fsync(out.fileno())
    if written != size or digest.hexdigest() != sha256:
        raise Refused("archive member does not match its manifest checksum.")
    os.utime(target, (member.mtime, member.mtime))


def restore(args, key):
    archive = checked_path(args.archive, "--archive")
    destination = checked_path(args.destination, "--destination")
    real_file(archive, "--archive", single_link=False)
    parent = os.path.dirname(destination)
    real_dir(parent, "--destination parent")
    if os.path.lexists(destination):
        real_dir(destination, "--destination")
        if os.listdir(destination):
            raise Refused("--destination already has content; restore only into a new empty root.")
    if inside(archive, destination):
        raise Refused("--archive must not be inside --destination.")
    limits = {"total": args.max_total_bytes, "file": args.max_file_bytes, "members": args.max_members}

    fd = os.open(archive, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as handle:
        opened = os.fstat(handle.fileno())
        header, nonce, prefix = read_header(handle)
        length = opened.st_size - len(prefix) - TAG_BYTES
        if length < 0:
            raise Refused("archive is truncated.")
        if length > limits["total"] + TAR_OVERHEAD or length > GCM_MAX_PLAINTEXT:
            raise Refused("archive exceeds the total size quota.")
        needed = 2 * length + args.min_free_bytes
        if free_bytes(parent) < needed:
            raise Refused(f"not enough free disk space: need {needed} bytes including the reserve.")

        environment = header["environment"]
        db_name = f"underwater-{environment}.db"
        work = tempfile.mkdtemp(prefix="." + os.path.basename(destination) + ".restore-", dir=parent)
        try:
            spool = os.path.join(work, "authenticated.tar")
            decrypt_to_spool(handle, key, nonce, prefix, length, spool)
            if identity(os.fstat(handle.fileno())) != identity(opened):
                raise Refused("archive changed while it was being read.")

            # Only authenticated plaintext from here on.
            clone = os.path.join(work, "clone")
            os.mkdir(clone, 0o700)
            os.mkdir(os.path.join(clone, "media"), 0o700)
            try:
                with tarfile.open(spool, mode="r:") as tar:
                    members = read_members(tar, db_name, limits)
                    manifest, listed = load_manifest(tar, members, header, db_name)
                    for member in members[:-1]:
                        write_member(tar, member, clone, *listed[member.name])
            except tarfile.TarError:
                raise Refused("archive tar stream is malformed.") from None
            os.unlink(spool)

            database = os.path.join(clone, db_name)
            connection = sqlite3.connect(quoted_uri(database, "mode=ro&immutable=1"), uri=True)
            try:
                checked = integrity(connection)
                stats = database_stats(connection)
            finally:
                connection.close()
            if checked != "ok":
                raise Refused("restored database failed PRAGMA integrity_check.")
            fsync_dir(clone)
            os.rename(clone, destination)
            fsync_dir(parent)
        finally:
            shutil.rmtree(work)

    media = manifest["media"]
    return {
        "status": "complete", "operation": "restore", "environment": environment,
        "created_at": header["created_at"], "destination": destination,
        "database": {"integrity": checked, "bytes": manifest["database"]["size"], "tables": stats["tables"],
                     "rows": stats["rows"], "latest_migration": stats["latest_migration"],
                     "source_journal_mode": manifest["database"].get("source_journal_mode")},
        "media": {"files": len(media), "bytes": sum(entry["size"] for entry in media)},
        "verified_files": len(listed),
    }


# --- cli -------------------------------------------------------------------------------

def parse(argv):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)
    make = commands.add_parser("backup")
    make.add_argument("--data-root", required=True)
    make.add_argument("--environment", required=True, choices=ENVIRONMENTS)
    make.add_argument("--destination", required=True)
    make.add_argument("--min-free-bytes", type=int, default=DEFAULT_RESERVE)
    back = commands.add_parser("restore")
    back.add_argument("--archive", required=True)
    back.add_argument("--destination", required=True)
    back.add_argument("--min-free-bytes", type=int, default=DEFAULT_RESERVE)
    back.add_argument("--max-total-bytes", type=int, default=DEFAULT_MAX_TOTAL)
    back.add_argument("--max-file-bytes", type=int, default=DEFAULT_MAX_FILE)
    back.add_argument("--max-members", type=int, default=DEFAULT_MAX_MEMBERS)
    args = parser.parse_args(argv)
    for name in ("min_free_bytes", "max_total_bytes", "max_file_bytes", "max_members"):
        if getattr(args, name, 0) < 0:
            parser.error(f"--{name.replace('_', '-')} must not be negative")
    return args


def main(argv=None):
    os.umask(0o077)
    args = parse(argv)
    label = "[" + args.command + "]"
    try:
        key = read_key(sys.stdin.buffer)
        report = backup(args, key) if args.command == "backup" else restore(args, key)
    except Refused as error:
        print(f"{label} refused: {error}", file=sys.stderr)
        return 2
    except Exception as error:  # noqa: BLE001 - report the failure without a traceback
        print(f"{label} failed: {type(error).__name__}: {error}", file=sys.stderr)
        return 1
    print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
