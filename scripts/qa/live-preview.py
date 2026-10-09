"""Verify only our isolated HTTPS preview; optional clearly synthetic commerce.

Credentials are read from Keychain in memory. Redirects are never followed with
credentials. No client host, source database, mail send or real payment is used.
Synthetic records are retained for audit and their catalogue fixture is hidden.
"""
import argparse
import base64
from datetime import datetime, timezone
from http.cookiejar import CookieJar
import json
from pathlib import Path
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'source'))
from keychain import read_secret, security

ORIGIN = 'https://underwater-demo.programo.pl'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--commerce', action='store_true', help='Create, verify and hide one labelled TEST catalogue fixture on our preview only.')
    args = parser.parse_args()
    security().SecKeychainSetUserInteractionAllowed(False)
    password = read_secret('programo.underwater.preview.basic-password')
    if not password: raise PermissionError('Approved preview credential unavailable; no interactive prompt opened.')
    authorization = 'Basic ' + base64.b64encode(b'wojtek-underwater:' + password).decode()
    del password
    cookies = CookieJar()
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPCookieProcessor(cookies))

    def request(path, authenticated=False, method='GET', body=None, extra=None):
        parts = urllib.parse.urlsplit(path)
        if not path.startswith('/') or path.startswith('//') or parts.scheme or parts.netloc or parts.fragment:
            raise ValueError('Only a relative own-preview path is allowed.')
        headers = {'User-Agent': 'Programo-Underwater-preview-verification/1.0'}
        if authenticated: headers['Authorization'] = authorization
        if body is not None: headers.update({'Origin': ORIGIN, 'Content-Type': 'application/json'})
        headers.update(extra or {})
        req = urllib.request.Request(ORIGIN + path, data=None if body is None else json.dumps(body).encode(), headers=headers, method=method)
        try: response = opener.open(req, timeout=45)
        except urllib.error.HTTPError as error: response = error
        with response:
            data = response.read(4 * 1024 * 1024 + 1)
            if len(data) > 4 * 1024 * 1024: raise ValueError('Preview response exceeds the verification bound.')
            return response.status, {key.lower(): value for key, value in response.headers.items()}, data

    def api(path, method='GET', body=None, expected=200):
        status, _, data = request(path, True, method, body)
        if status != expected: raise AssertionError(f'Own-preview API returned {status}; expected {expected} for {path.split("?")[0]}. Response body was not printed.')
        return json.loads(data)

    checks = []
    for path in ['/', '/admin', '/api/products', '/api/orders', '/api/media/file/missing.jpg', '/_next/static/missing.js']:
        status, _, _ = request(path)
        assert status == 401, (path, status)
    checks.append({'anonymousPreviewProtected': 6})
    status, headers, body = request('/', True)
    assert status == 200
    assert 'noindex' in headers.get('x-robots-tag', '') and 'no-store' in headers.get('cache-control', '')
    assert b'underwater-demo.programo.pl' in body
    checks.append({'home': status, 'noindex': True, 'noStore': True, 'bytes': len(body)})
    health = api('/api/health')
    assert health.get('ok') is True and health.get('environment') == 'preview' and health.get('payments') == 'test' and health.get('paymentProvider') == 'internal-test' and health.get('mail') == 'captured' and health.get('maintenance', {}).get('ok') is True
    checks.append({'health': {'ok': True, 'environment': 'preview', 'paymentProvider': 'internal-test', 'mail': 'captured', 'maintenanceOK': True}})
    api('/api/store/quote', 'POST', {'items': []}, 400)
    checks.append({'emptyQuote': 400})
    # Cookie jar is still empty, so Basic preview access does not grant a CMS role.
    for collection in ['orders', 'users', 'signups', 'contacts', 'newsletter', 'outbox', 'payment-attempts', 'payment-events', 'audit-events', 'import-runs']:
        status, _, _ = request('/api/' + collection, True)
        assert status in {401, 403}, (collection, status)
    checks.append({'privateCollectionsDenyMissingCMSLogin': 10})
    status, _, _ = request('/missing-live-preview-check-20261008.html', True)
    assert status == 404
    status, _, _ = request('/api/store/quote', True, 'POST', {'items': []}, {'Origin': 'https://untrusted.example.invalid'})
    assert status == 403
    checks.append({'missingRoute': 404, 'crossOrigin': 403})

    if args.commerce:
        admin_password = read_secret('programo.underwater.preview.admin-password')
        if not admin_password: raise PermissionError('Approved CMS credential unavailable.')
        login = api('/api/users/login', 'POST', {'email': 'underwater-preview@programo.pl', 'password': admin_password.decode()})
        del admin_password, login
        assert any(cookie.name.endswith('token') for cookie in cookies), 'CMS login must establish a cookie; Basic auth remains in its own header.'
        slug = 'test-live-' + uuid.uuid4().hex
        category = api('/api/categories', 'POST', {'name': 'TEST — kontrola wdrożenia, dane syntetyczne', 'slug': slug, 'published': False}, 201)['doc']
        product, input_order, token = None, None, None
        try:
            product = api('/api/products', 'POST', {
                'name': 'TEST — kontrola zamówienia, bez sprzedaży i wysyłki', 'slug': slug + '-product',
                'vmId': int(uuid.uuid4().int % 1_000_000_000) + 1_100_000_000,
                'category': category['id'], 'price': 20, 'stock': 0, 'published': True,
                'short': 'Jawny, tymczasowo opublikowany produkt syntetyczny użyty wyłącznie do kontroli własnego wdrożenia.',
            }, 201)['doc']
            api('/api/operations/records', 'POST', {'command': 'inventory-adjustment', 'id': product['id'], 'stock': 2, 'expectedStock': 0})
            input_items = [{'id': product['id'], 'qty': 1, 'price': 0.01}]
            quoted = api('/api/store/quote', 'POST', {'items': input_items})['quote']
            assert quoted['subtotalCents'] == 2000 and quoted['currency'] == 'PLN'
            input_order = {'idempotencyKey': uuid.uuid4().hex, 'customerName': 'TEST LIVE — dane syntetyczne', 'email': 'live-qa@example.invalid', 'phone': '000000000', 'address': 'TEST — adres syntetyczny, bez wysyłki', 'privacyAccepted': True, 'termsAccepted': True, 'items': input_items, 'deliveryMethod': quoted['deliveryMethod'], 'expectedTotalCents': quoted['totalCents']}
            created = api('/api/store/checkout', 'POST', input_order)
            payment_path = urllib.parse.urlsplit(created['paymentURL'])
            assert not payment_path.scheme and not payment_path.netloc and payment_path.path == '/platnosc-testowa'
            token = urllib.parse.parse_qs(payment_path.query)['token'][0]
            duplicate = api('/api/store/checkout', 'POST', input_order)
            assert duplicate['number'] == created['number']
            summary = api('/api/payments/test?token=' + urllib.parse.quote(token, safe=''))
            assert summary['totalCents'] == quoted['totalCents']
            for _ in range(2): api('/api/payments/test', 'POST', {'token': token, 'outcome': 'cancelled'})
            after = api('/api/products/' + str(product['id']) + '?depth=0')
            assert after['stock'] == 2
            orders = api('/api/orders?depth=0&where[number][equals]=' + urllib.parse.quote(created['number'], safe=''))
            assert orders['totalDocs'] == 1 and orders['docs'][0]['mode'] == 'test' and orders['docs'][0]['paymentStatus'] == 'cancelled'
            checks.append({'syntheticCommerce': {'serverPriceCents': 2000, 'totalCents': quoted['totalCents'], 'idempotentCheckout': True, 'cancelledTwice': True, 'stockRestored': True, 'cmsAudit': True, 'testOrderNumber': created['number']}})
        finally:
            active_error = sys.exc_info()[1]
            cleanup_errors = []
            # Inspect the unique input after an uncertain checkout; never repeat it.
            if input_order is not None:
                try:
                    query = '/api/orders?depth=0&where[idempotencyKey][equals]=' + urllib.parse.quote(input_order['idempotencyKey'], safe='')
                    own_orders = api(query)
                    assert own_orders['totalDocs'] <= 1
                    for order in own_orders['docs']:
                        assert order['mode'] == 'test' and order['email'] == input_order['email']
                        if order['paymentStatus'] == 'pending':
                            api('/api/operations/records', 'POST', {'command': 'update-status', 'collection': 'orders', 'id': order['id'], 'status': 'cancelled'})
                        after = api('/api/orders/' + str(order['id']) + '?depth=0')
                        assert after['paymentStatus'] in {'cancelled', 'failed', 'expired'} and after['stockReleased'] is True
                except Exception as error: cleanup_errors.append({'step': 'close-synthetic-order', 'errorType': type(error).__name__})
            # Every cleanup step runs even after another fails; retain audit evidence.
            for collection, fixture in [('products', product), ('categories', category)]:
                if fixture is None: continue
                try:
                    fixture_path = '/api/' + collection + '/' + str(fixture['id'])
                    api(fixture_path, 'PATCH', {'published': False})
                    assert api(fixture_path + '?depth=0')['published'] is False
                except Exception as error: cleanup_errors.append({'step': 'hide-' + collection, 'id': fixture['id'], 'errorType': type(error).__name__})
            checks.append({'syntheticFixturesHidden': not cleanup_errors, 'cleanupErrors': cleanup_errors})
            if cleanup_errors:
                print(json.dumps({'ownPreviewOnly': True, 'cleanupRequiresAttention': cleanup_errors}))
                if active_error is None: raise RuntimeError('Synthetic preview cleanup requires attention; fixture IDs are in the sanitized report.')
    print(json.dumps({'checkedAt': datetime.now(timezone.utc).isoformat(), 'origin': ORIGIN, 'ownPreviewOnly': True, 'checks': checks, 'clientWrites': False, 'realPayments': False, 'realMail': False}))


if __name__ == '__main__': main()
