"""Bounded public-image prefetch; archive and manifest writes stay on the caller."""
from collections import deque
from concurrent.futures import ThreadPoolExecutor
import time
from urllib.parse import quote, urlsplit
from public_capture import allowed, get


def download(row):
    last_error = None
    for candidate in [row['url'], *row.get('alternateUrls', [])]:
        parts = urlsplit(candidate)
        url = parts._replace(path=quote(parts.path, safe='/%')).geturl()
        try:
            body, final, _ = get(url)
            if not allowed(final) or len(body) > 12 * 1024 * 1024:
                raise ValueError('Invalid public image response.')
            time.sleep(0.35)
            return body
        except Exception as error:
            last_error = error
    raise last_error or ValueError('No public image URL.')


def prefetch(rows, cached, fetcher=download, workers=3, cached_only=False, blocked_keys=None):
    if isinstance(workers, bool) or not isinstance(workers, int) or not 1 <= workers <= 3:
        raise ValueError('Public-image concurrency must be between one and three.')
    iterator = iter(enumerate(rows))
    pending = deque()
    # At most six image bodies (each bounded by get()) are held ahead of the
    # caller. Only this generator's workers exist, and context exit joins them.
    with ThreadPoolExecutor(max_workers=workers) as pool:
        def submit():
            try:
                index, row = next(iterator)
            except StopIteration:
                return False
            previous = cached(row)
            pending.append((index, row, previous, None if previous or cached_only or row['key'] in (blocked_keys or set()) else pool.submit(fetcher, row)))
            return True
        for _ in range(workers * 2):
            if not submit(): break
        while pending:
            index, row, previous, future = pending.popleft()
            body = None
            error = FileNotFoundError('No verified cached image.') if cached_only and not previous else PermissionError('Archived source failure was not retried.') if not previous and row['key'] in (blocked_keys or set()) else None
            if future:
                try: body = future.result()
                except Exception as failure: error = failure
            yield index, row, previous, body, error
            submit()
