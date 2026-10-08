"""Private VM worker. Credentials/key are read from stdin and never persisted/logged.
Copies only authorized inventory files over 1..4 independent read-only FTPS
connections; every file is encrypted on arrival. No PHP runs, no plaintext lands.

Threads: one coordinator (main thread) owns the manifest, the dispatch queue and
every checkpoint write. Each download thread owns exactly one FTP connection and
returns plain result dicts; it never touches the manifest.
"""
import argparse
import base64
import errno
import fcntl
import ftplib
import hashlib
import json
import os
import pathlib
import queue
import signal
import socket
import ssl
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.exceptions import InvalidTag
from ftp_readonly import ReadOnlyFTP, HOST, ACCOUNT, EXPECTED_ADDRESS

DEST = pathlib.Path('/root/underwater/source/20261008')
AAD = b'underwater-source-manifest'
MANIFEST_MAGIC = b'UWENC1'
OBJECT_MAGIC = b'UWENC2'
OBJECT_OVERHEAD = 6 + 12 + 16
ROOTS = {'public_html', 'vmfiles', 'tylkopliki'}
SHELL_HISTORY = {'.bash_history', '.zsh_history'}
FREE_RESERVE = 5 * 1024**3
MAX_CONNECTIONS = 4
FILE_ATTEMPTS = 3
CONNECT_ATTEMPTS = 5
BLOCK = 128 * 1024
PROGRESS_FILES = 100
PROGRESS_SECONDS = 10.0
CHECKPOINT_SECONDS = 10.0
SHUTDOWN_GRACE = 15.0
RETRY_DELAY = 2.0
CONNECT_DELAY = 3.0
LOCAL_DISK_ERRNOS = {errno.ENOSPC, errno.EDQUOT, errno.EROFS, errno.EACCES}


class Interrupted(Exception):
    """Stop was requested while this thread was working."""


class SourceChanged(Exception):
    """SIZE/MDTM before and after the transfer disagree with the bytes received."""


class InsufficientSpace(Exception):
    pass


class AlreadyRunning(Exception):
    pass


class Fatal(Exception):
    """Wraps an error that must stop the whole run (auth, certificate, policy, disk)."""

    def __init__(self, error_type):
        super().__init__(error_type)
        self.error_type = error_type


class Retire(Exception):
    """This thread could not open its connection; others may continue."""

    def __init__(self, error_type):
        super().__init__(error_type)
        self.error_type = error_type


class TrackedFTP(ReadOnlyFTP):
    """ReadOnlyFTP (same command allowlist) that remembers its data socket so a
    stuck transfer can be unblocked from the coordinator during shutdown."""
    data_socket = None

    def ntransfercmd(self, cmd, rest=None):
        conn, size = super().ntransfercmd(cmd, rest)
        self.data_socket = conn
        return conn, size

    def interrupt(self):
        for sock in (self.data_socket, self.sock):
            if sock is not None:
                try: socket.socket.shutdown(sock, socket.SHUT_RDWR)
                except (OSError, ValueError): pass


def seal_json(key, data):
    nonce = os.urandom(12)
    return MANIFEST_MAGIC + nonce + AESGCM(key).encrypt(nonce, json.dumps(data, ensure_ascii=False, sort_keys=True).encode(), AAD)


def open_json(blob, key, label):
    if blob[:6] != MANIFEST_MAGIC: raise ValueError('Unrecognized ' + label + '.')
    return json.loads(AESGCM(key).decrypt(blob[6:18], blob[18:], AAD))


def atomic_write(target, blob, token):
    part = target.with_name(target.name + '.' + token + '.part')
    fd = os.open(part, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(blob); stream.flush(); os.fsync(stream.fileno())
        os.replace(part, target)
    except BaseException:
        try: part.unlink()
        except FileNotFoundError: pass
        raise


def excluded(path):
    return any(p in SHELL_HISTORY or p.startswith('.env') for p in path.split('/'))


def safe_path(path):
    parts = path.split('/')
    if parts[0] not in ROOTS or any(p in {'', '.', '..'} for p in parts) or any(c in path for c in ['\\', '\r', '\n', '\x00']):
        raise PermissionError('Unsafe source path.')
    return path


def object_name(path):
    return hashlib.sha256(path.encode()).hexdigest() + '.enc'


def free_bytes(path):
    stats = os.statvfs(path)
    return stats.f_bavail * stats.f_frsize


def connect(password):
    if socket.gethostbyname(HOST) != EXPECTED_ADDRESS: raise PermissionError('Authorized source address changed.')
    ftp = TrackedFTP(context=ssl.create_default_context(), timeout=40)
    try:
        ftp.connect(HOST, 21); ftp.login(ACCOUNT, password); ftp.prot_p(); ftp.voidcmd('TYPE I')
        return ftp
    except BaseException:
        ftp.close()
        raise


def resumed_object_valid(target, record, key):
    """Authenticate and hash the old ciphertext before trusting a resume entry."""
    try:
        if target.stat().st_size != record['bytes'] + OBJECT_OVERHEAD: return False
        with target.open('rb') as stream:
            header = stream.read(18)
            if header[:6] != OBJECT_MAGIC: return False
            stream.seek(-16, 2); tag = stream.read(16); stream.seek(18)
            decryptor = Cipher(algorithms.AES(key), modes.GCM(header[6:18], tag)).decryptor(); decryptor.authenticate_additional_data(record['path'].encode())
            digest = hashlib.sha256(); remaining = record['bytes']
            while remaining:
                chunk = stream.read(min(BLOCK, remaining))
                if not chunk: return False
                remaining -= len(chunk); digest.update(decryptor.update(chunk))
            digest.update(decryptor.finalize())
            return digest.hexdigest() == record['sha256']
    except (OSError, ValueError, KeyError, TypeError, InvalidTag): return False


def fatal_type(error, connecting=False):
    """Name of an error that must not be retried, else None."""
    if isinstance(error, Fatal): return error.error_type
    if isinstance(error, (ssl.SSLCertVerificationError, PermissionError, InsufficientSpace)): return type(error).__name__
    if isinstance(error, ftplib.error_perm) and (connecting or str(error)[:3] in {'530', '532'}): return type(error).__name__
    if isinstance(error, OSError) and error.errno in LOCAL_DISK_ERRNOS: return type(error).__name__
    return None


TRANSIENT = (OSError, EOFError, ValueError, SourceChanged) + ftplib.all_errors


def connect_failure(error):
    """Fatal error name for a failed login/connect; None if a retry may help."""
    return fatal_type(error, connecting=True) or (None if isinstance(error, TRANSIENT) else type(error).__name__)


class Slot:
    """One download thread and the single connection it owns."""

    def __init__(self, index):
        self.index = index
        self.ftp = None
        self.part = None
        self.thread = None


class Worker:
    def __init__(self, key, password, objects, connect_fn, stop, run_id):
        self.key = key; self.password = password; self.objects = objects
        self.connect = connect_fn; self.stop = stop; self.run_id = run_id
        # Until one login succeeds, logins are serialized: a wrong password or
        # certificate costs one attempt, not one per connection.
        self.gate = threading.Lock(); self.proven = False

    def loop(self, slot, tasks, results):
        try:
            while True:
                task = tasks.get()
                if task is None: break
                if self.stop.is_set():
                    results.put({'kind': 'skipped', 'path': task[0]}); continue
                try: outcome = self.process(slot, task)
                except BaseException as error:
                    self.discard(slot); self.close(slot)
                    outcome = {'kind': 'fatal', 'path': task[0], 'error_type': type(error).__name__}
                results.put(outcome)
                if outcome['kind'] in {'requeue', 'fatal'}: break
        finally:
            self.close(slot, polite=not self.stop.is_set())
            results.put({'kind': 'exit', 'slot': slot.index})

    def close(self, slot, polite=False):
        ftp, slot.ftp = slot.ftp, None
        if ftp is None: return
        if polite:
            try: ftp.quit(); return
            except Exception: pass
        try: ftp.close()
        except Exception: pass

    def login(self):
        if self.proven: return self.connect(self.password)
        while not self.gate.acquire(timeout=0.5):
            if self.stop.is_set(): raise Interrupted()
        try:
            if self.stop.is_set(): raise Interrupted()
            try: ftp = self.connect(self.password)
            except Exception as error:
                # Stop while still holding the gate, so no waiting thread logs in again.
                if connect_failure(error): self.stop.set()
                raise
            self.proven = True
            return ftp
        finally:
            self.gate.release()

    def ensure_connection(self, slot):
        if slot.ftp is not None: return slot.ftp
        last = 'OSError'
        for attempt in range(CONNECT_ATTEMPTS):
            if self.stop.is_set(): raise Interrupted()
            try:
                slot.ftp = self.login()
                return slot.ftp
            except Interrupted: raise
            except Exception as error:
                kind = connect_failure(error)
                if kind: self.stop.set(); raise Fatal(kind)
                last = type(error).__name__
            if attempt + 1 < CONNECT_ATTEMPTS: self.stop.wait(min(15, CONNECT_DELAY * (attempt + 1)))
        raise Retire(last)

    def process(self, slot, task):
        path, row, previous = task
        target = self.objects / object_name(path)
        was_complete = bool(previous and previous.get('complete'))
        if target.exists():
            if was_complete and previous.get('inventory_bytes') == row['size'] and resumed_object_valid(target, previous, self.key):
                return {'kind': 'done', 'path': path, 'record': previous, 'resumed': True}
            # Never overwrite or delete an existing object: keep it beside the new copy.
            if not was_complete: reason = 'unrecorded'
            elif previous.get('inventory_bytes') != row['size'] and resumed_object_valid(target, previous, self.key): reason = 'superseded'
            else: reason = 'corrupt'
            target.rename(self.objects / (target.name[:-4] + '.' + reason + '-' + uuid.uuid4().hex + '.enc'))
        # From here on an old "complete" record no longer describes a file on disk.
        base = {'path': path, 'invalidated': was_complete}
        last = None
        for attempt in range(FILE_ATTEMPTS):
            if self.stop.is_set(): return dict(base, kind='interrupted')
            try:
                ftp = self.ensure_connection(slot)
                return dict(base, kind='done', record=self.transfer(slot, ftp, path, row, target), resumed=False)
            except Retire as error:
                return dict(base, kind='requeue', task=(path, row, None), error_type=error.error_type)
            except BaseException as error:
                self.discard(slot); self.close(slot)
                if isinstance(error, Interrupted): return dict(base, kind='interrupted')
                # Auth/cert/policy/disk errors stay fatal even while stopping; anything
                # else seen during a stop is the side effect of our own socket cut.
                kind = fatal_type(error)
                if not kind and self.stop.is_set(): return dict(base, kind='interrupted')
                kind = kind or (None if isinstance(error, TRANSIENT) else type(error).__name__)
                if kind:
                    self.stop.set(); return dict(base, kind='fatal', error_type=kind)
                last = type(error).__name__
            if attempt + 1 < FILE_ATTEMPTS: self.stop.wait(RETRY_DELAY * (attempt + 1))
        return dict(base, kind='failed', record={'path': path, 'complete': False, 'error_type': last, 'attempts': FILE_ATTEMPTS, 'inventory_bytes': row['size']})

    def discard(self, slot):
        # Deleting this worker's own incomplete ciphertext only is authorized.
        part, slot.part = slot.part, None
        if part is not None:
            try: part.unlink()
            except FileNotFoundError: pass

    def transfer(self, slot, ftp, path, row, target):
        remote = '/' + path
        before = ftp.size(remote); before_time = mdtm(ftp, remote)
        nonce = os.urandom(12)
        encryptor = Cipher(algorithms.AES(self.key), modes.GCM(nonce)).encryptor(); encryptor.authenticate_additional_data(path.encode())
        digest = hashlib.sha256(); received = 0
        slot.part = self.objects / (target.name[:-4] + '.' + self.run_id + '.part')
        fd = os.open(slot.part, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(OBJECT_MAGIC + nonce)

            def append(chunk):
                nonlocal received
                if self.stop.is_set(): raise Interrupted()
                received += len(chunk); digest.update(chunk); stream.write(encryptor.update(chunk))
            ftp.retrbinary('RETR ' + remote, append, blocksize=BLOCK)
            stream.write(encryptor.finalize()); stream.write(encryptor.tag); stream.flush(); os.fsync(stream.fileno())
        after = ftp.size(remote); after_time = mdtm(ftp, remote)
        if before != received or after != received or before_time != after_time: raise SourceChanged()
        os.replace(slot.part, target); slot.part = None
        return {'path': path, 'object': target.name, 'bytes': received, 'inventory_bytes': row['size'], 'sha256': digest.hexdigest(), 'source_mdtm': after_time, 'changed_since_inventory': row['size'] != received, 'complete': True}


def mdtm(ftp, remote):
    try: return ftp.sendcmd('MDTM ' + remote)
    except ftplib.error_perm as error:
        if str(error)[:3] in {'530', '532'}: raise
        return None


def priority(row):
    path = row['path'].lower()
    if path.endswith(('.sql', '.sql.gz', '.jpa', '.jps')): return 0
    if '/shop_image/product/' in path and '/resized/' not in path: return 1
    if '/images/' in path and not any(p in path for p in ['/resized/', '/thumbs/', '/thumbnails/']): return 2
    if '/cache/' in path: return 5
    return 3


def emit(data):
    try: print(json.dumps(data), flush=True)
    except (BrokenPipeError, OSError): pass


def interrupt_connection(ftp):
    hook = getattr(ftp, 'interrupt', None)
    if hook is not None:
        try: hook()
        except Exception: pass


def run(key, password, dest=None, connections=MAX_CONNECTIONS, connect_fn=None, stop=None, grace=None, out=emit):
    """Copy every inventory file once. Returns the summary dict; the encrypted
    checkpoint on disk is always the coordinator's last consistent view."""
    if isinstance(connections, bool) or not isinstance(connections, int) or not 1 <= connections <= MAX_CONNECTIONS: raise ValueError('Connections must be 1..4.')
    if len(key) != 32 or not password: raise ValueError('Invalid private credential input.')
    dest = pathlib.Path(dest or DEST); connect_fn = connect_fn or connect; stop = stop or threading.Event()
    grace = SHUTDOWN_GRACE if grace is None else grace
    dest.mkdir(parents=True, exist_ok=True, mode=0o700); os.chmod(dest, 0o700)
    objects = dest / 'objects'; objects.mkdir(exist_ok=True, mode=0o700)
    lock = os.open(dest / 'snapshot.lock', os.O_WRONLY | os.O_CREAT, 0o600)
    try:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError: raise AlreadyRunning('Another snapshot worker holds the lock.')
        return Coordinator(key, password, dest, objects, connections, connect_fn, stop, grace, out).run()
    finally:
        os.close(lock)


class Coordinator:
    def __init__(self, key, password, dest, objects, connections, connect_fn, stop, grace, out):
        self.key = key; self.dest = dest; self.stop = stop; self.grace = grace; self.out = out
        self.connections = connections
        self.run_id = uuid.uuid4().hex[:12]
        self.worker = Worker(key, password, objects, connect_fn, stop, self.run_id)
        self.manifest = dest / 'download-manifest.enc'
        # Inventory bytes are read once: the same buffer is hashed and decrypted.
        blob = (dest / 'inventory.enc').read_bytes()
        inventory = open_json(blob, key, 'inventory')
        self.rows, self.excluded, seen = [], [], set()
        for row in inventory['files']:
            path = safe_path(row['path'])
            if path in seen: raise ValueError('Duplicate inventory path.')
            seen.add(path)
            if excluded(path): self.excluded.append({'path': path, 'reason': 'secret-environment-or-shell-history'})
            else: self.rows.append(row)
        self.rows.sort(key=lambda row: (priority(row), row['path']))
        self.paths = {row['path'] for row in self.rows}
        # A tampered or foreign manifest raises here and stays untouched on disk.
        previous = open_json(self.manifest.read_bytes(), key, 'download manifest') if self.manifest.exists() else {}
        self.records = {record['path']: record for record in previous.get('files', [])}
        self.report = {
            'started_at': datetime.now(timezone.utc).isoformat(), 'mode': 'read-only-encrypted-files', 'database_snapshot': False,
            'worker': 'parallel', 'connections': connections, 'run_id': self.run_id,
            'inventory_complete': inventory.get('complete_inventory') is True, 'inventory_sha256': hashlib.sha256(blob).hexdigest(),
            'inventory_files': len(seen), 'skipped': inventory.get('skipped', []), 'excluded': self.excluded, 'complete_snapshot': False,
        }
        if previous.get('started_at'): self.report['first_started_at'] = previous.get('first_started_at', previous['started_at'])
        self.failed = {path for path, record in self.records.items() if path in self.paths and not record.get('complete')}
        self.verified = set()
        self.stats = {'processed': 0, 'downloaded': 0, 'resumed': 0, 'bytes': 0, 'max_in_flight': 0}
        self.tasks, self.results = queue.Queue(), queue.Queue()
        self.slots = [Slot(index) for index in range(connections)]
        self.in_flight = 0; self.live = connections; self.exited = set(); self.reserved = {}
        self.fatal = None
        now = time.monotonic()
        self.saved_at = now; self.save_cost = 0.0; self.progress_at = now; self.progress_count = 0

    def checkpoint(self, force=False):
        now = time.monotonic()
        # A full save is O(files); space saves so they cost at most ~10% of wall time.
        if not force and now - self.saved_at < max(CHECKPOINT_SECONDS, 10 * self.save_cost): return
        self.report['database_snapshot'] = False
        snapshot = dict(self.report, files=list(self.records.values()), saved_at=datetime.now(timezone.utc).isoformat())
        atomic_write(self.manifest, seal_json(self.key, snapshot), self.run_id)
        self.saved_at = time.monotonic(); self.save_cost = self.saved_at - now

    def progress(self, force=False):
        now = time.monotonic()
        if not force and self.stats['processed'] - self.progress_count < PROGRESS_FILES and now - self.progress_at < PROGRESS_SECONDS: return
        self.progress_at = now; self.progress_count = self.stats['processed']
        self.out({'processed': self.stats['processed'], 'source_files': len(self.rows), 'downloaded': self.stats['downloaded'], 'resumed': self.stats['resumed'],
                  'bytes': self.stats['bytes'], 'failures': len(self.failed), 'in_flight': self.in_flight, 'live_connections': self.live})

    def settle(self, result):
        kind = result['kind']
        if kind == 'exit':
            self.exited.add(result['slot']); return
        path = result['path']
        if result.get('invalidated') and kind != 'done': self.records.pop(path, None)
        if kind == 'done':
            record = self.records[path] = result['record']
            self.verified.add(path); self.failed.discard(path)
            self.stats['resumed' if result['resumed'] else 'downloaded'] += 1; self.stats['bytes'] += record['bytes']; self.stats['processed'] += 1
        elif kind == 'failed':
            self.records[path] = result['record']; self.failed.add(path); self.stats['processed'] += 1
        elif kind == 'requeue':
            self.live -= 1
            self.out({'connection_retired': True, 'error_type': result['error_type'], 'live_connections': self.live})
            if self.live > 0 and not self.stop.is_set():
                self.tasks.put(result['task']); return
            if self.live == 0 and self.fatal is None: self.fatal = 'NoConnections'; self.stop.set()
        elif kind == 'fatal':
            if self.fatal is None: self.fatal = result['error_type']
            self.stop.set()
        self.in_flight -= 1; self.reserved.pop(path, None)

    def dispatch(self, pending):
        """Fill the bounded window; returns True once every row was dispatched."""
        while not self.stop.is_set() and self.in_flight < 2 * self.connections:
            row = next(pending, None)
            if row is None: return True
            if free_bytes(self.dest) - sum(self.reserved.values()) < max(row['size'] * 2, FREE_RESERVE):
                self.fatal = 'InsufficientSpace'; self.stop.set(); return False
            self.tasks.put((row['path'], row, self.records.get(row['path'])))
            self.reserved[row['path']] = row['size']; self.in_flight += 1
            self.stats['max_in_flight'] = max(self.stats['max_in_flight'], self.in_flight)
        return False

    def run(self):
        for slot in self.slots:
            slot.thread = threading.Thread(target=self.worker.loop, args=(slot, self.tasks, self.results), name='uw-ftp-%d' % slot.index, daemon=True)
            slot.thread.start()
        pending = iter(self.rows); exhausted = False; clean = False
        try:
            while True:
                exhausted = exhausted or self.dispatch(pending)
                if self.stop.is_set() or (exhausted and self.in_flight == 0): break
                try: self.settle(self.results.get(timeout=0.5))
                except queue.Empty: pass
                self.progress(); self.checkpoint()
            clean = exhausted and self.in_flight == 0 and self.fatal is None and not self.stop.is_set()
        except BaseException as error:
            self.fatal = self.fatal or type(error).__name__
            raise
        finally:
            if not clean: self.stop.set()
            abandoned = self.shutdown()
            finished = clean and not abandoned
            if finished:
                self.report['finished_at'] = datetime.now(timezone.utc).isoformat()
                self.report['complete_snapshot'] = (
                    self.report['inventory_complete'] and not self.excluded and self.verified == self.paths
                    and all(self.records[path].get('complete') and not self.records[path].get('changed_since_inventory') for path in self.paths)
                    and not self.report['skipped'])
            else:
                self.report['complete_snapshot'] = False
                self.report['stopped_at'] = datetime.now(timezone.utc).isoformat()
                self.report['stop_reason'] = self.fatal or 'interrupted'
            self.checkpoint(force=True)
        self.progress(force=True)
        summary = {'complete_snapshot': self.report['complete_snapshot'], 'finished': finished, 'stop_reason': self.report.get('stop_reason'),
                   'files': sum(1 for path in self.paths if self.records.get(path, {}).get('complete')), 'source_files': len(self.rows),
                   'failures': len(self.failed), 'downloaded': self.stats['downloaded'], 'resumed': self.stats['resumed'], 'bytes': self.stats['bytes'],
                   'max_in_flight': self.stats['max_in_flight'], 'connections': self.connections, 'abandoned_threads': len(abandoned)}
        self.out(summary)
        return summary

    def shutdown(self):
        """Stop dispatch, let in-flight work report, then force our sockets closed.
        Returns slots whose threads did not finish in time; they are daemon
        threads and cannot outlive the process."""
        while True:
            try: task = self.tasks.get_nowait()
            except queue.Empty: break
            if task is not None: self.settle({'kind': 'skipped', 'path': task[0]})
        for _ in self.slots: self.tasks.put(None)
        deadline = time.monotonic() + self.grace; forced = False
        while len(self.exited) < len(self.slots):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                if forced: break
                forced = True; deadline = time.monotonic() + 5.0
                for slot in self.slots:
                    if slot.index not in self.exited and slot.ftp is not None: interrupt_connection(slot.ftp)
                continue
            try: self.settle(self.results.get(timeout=min(0.5, remaining)))
            except queue.Empty: pass
        for slot in self.slots: slot.thread.join(timeout=0.1)
        abandoned = [slot for slot in self.slots if slot.thread.is_alive()]
        for slot in abandoned:
            # Only this run's own unfinished ciphertext; parts from other runs stay.
            part = slot.part
            if part is not None:
                try: part.unlink()
                except FileNotFoundError: pass
        return abandoned


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--connections', type=int, default=MAX_CONNECTIONS, choices=range(1, MAX_CONNECTIONS + 1))
    options = parser.parse_args(argv)
    supplied = json.loads(sys.stdin.readline())
    key = base64.b64decode(supplied.pop('key'), validate=True); password = base64.b64decode(supplied.pop('password'), validate=True).decode()
    if supplied: raise ValueError('Unknown credential fields.')
    stop = threading.Event(); received = []

    def on_signal(signum, frame):
        received.append(signum); stop.set()
    for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP): signal.signal(signum, on_signal)
    try:
        summary = run(key, password, DEST, options.connections, stop=stop)
    finally:
        del password, key
    if received: return 128 + received[0]
    return 0 if summary['finished'] else 1


def cli(argv=None):
    try: return main(argv)
    except Exception as error:
        emit({'complete_snapshot': False, 'error_type': type(error).__name__})
        return 1


if __name__ == '__main__':
    raise SystemExit(cli())
