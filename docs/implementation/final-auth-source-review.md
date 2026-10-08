## Stan po weryfikacji prowadzącego

Obie uwagi poprawiono: adres aplikacji trafia do raportu zamiast do przekierowań, a runtime odmawia dodatkowego mountu pod `/data` oraz niewłaściwego typu volume. Testy uruchamiają rzeczywiste funkcje konwertera i kontrolę celu runtime; pięć nieprawidłowych konfiguracji jest odrzucanych przed wywołaniem aplikacji. Pełny wcześniejszy zestaw 178/178 przeszedł, wraz z testem dwóch niezależnych procesów kupujących ostatnią sztukę (`tests/integration.test.ts`); ostatnie zdanie recenzenta o braku takiego testu opisuje ograniczony zakres jego odczytu. Nowa kontrola ma osobny test regresji.

Poniżej oryginalny raport Opusa z odczytu, bez przypisywania mu wykonania testów.

## Przegląd: reset hasła, adapter SQLite, przekierowania z crawla, runtime-preview

Niczego nie uruchamiałem: ani testów, ani buildu, ani Pythona. Wszystkie wnioski pochodzą z czytania kodu, w tym `payload@3.90.2` i `drizzle-orm` (libsql) w `node_modules`.

### Wymagania sprawdzone bez zastrzeżeń

- **Throttle resetu odpowiada jak dla nieznanego konta.** `preparePasswordResetCapture` (`src/lib/auth-capture.ts:12-25`) robi snapshot po `initTransaction`, czyli pod lease i `BEGIN IMMEDIATE`. Równoległe żądania widzą więc `resetPasswordRequestedAt` poprzedniego. Przy throttlu tokenem i datą wygaśnięcia ze snapshotu nadpisujemy w tej samej transakcji token, który SDK właśnie zapisało (`:36-38`), a hook zwraca `null` (`Users.ts:28`). Endpoint REST (`auth/endpoints/forgotPassword.js:19`) i tak zwraca zawsze `success`, a lokalne API daje `null` tak samo jak dla nieznanego konta. Wcześniejszy działający token zostaje.
- **Jedna transakcja na wszystkie zapisy resetu.** Token (SDK, `req`), `resetPasswordRequestedAt` (`:44`, `req`) i outbox (`mailReq.transactionID = req.transactionID`, `:50-51`) idą przez tę samą transakcję. Gdy capture rzuci wyjątek, `killTransaction` cofa całość. `releaseRequestInterval` jest `null`, bo `disableEmail: true`.
- **Błąd COMMIT dochodzi do wywołującego.** `commitTransaction` (`sqlite-adapter.ts:140-147`) czeka na `completion`. Drizzle przy błędzie COMMIT robi `rollback` i rzuca dalej (`libsql/session.js:72-76`). Payloadowy `commitTransaction` nie łapie wyjątków. Watchdog zostawia zamkniętą sesję, więc późniejszy COMMIT też się wywróci.
- **Nieudane logowanie.** `incrementLoginAttempts` działa przed `initTransaction` i bez `req`. Wrapper `updateOne` (`:163-176`) czeka na lease i zostawia autocommit z `$inc`. W ścieżce rehash błąd z wrappera łapie samo SDK (`login.js:265`). Wszystkie zapisy auth w SDK idą przez `db.updateOne`, więc wrapper je obejmuje.
- **Przekierowania z crawla nie przesłaniają żywej treści.** Runtime traktuje przekierowanie jako ostatnią opcję (`source-routes.ts:115`). Do tego `Redirects.beforeValidate` blokuje opublikowaną treść, a `validateBundle` blokuje kolizje adresów. `destination()` przyjmuje tylko cel, który ma żywy adres w bundlu. Inaczej zgłasza issue `unresolved` albo `home-review`, nie zgaduje celu.
- **Sekrety w runtime-preview.** Hasło idzie przez stdin (ssh → python → `docker exec -i`), nie przez argv. Przy błędzie wypisywany jest tylko kod wyjścia. `GUARD` sprawdza env w kontenerze, zanim cokolwiek zaimportuje (import jest dynamiczny). Kontener musi być dokładnie jeden, a obraz musi być `app:commit`.
- **Nowe testy sprawdzają to, co mają sprawdzać.**
  - Test równoległego resetu: lease serializuje żądania, więc są dokładnie jeden token, jeden wpis w outboxie i dwa `null`.
  - Test COMMIT z odroczonym FK: wstrzyknięty INSERT wykonuje się po `finish()`, więc FK pada naprawdę na COMMIT. Test sprawdza, że outbox i stan resetu wracają do poprzedniego stanu, a sesji nie ma.

### Do poprawy (niski priorytet)

**1. Przekierowanie z adresu aplikacji wywraca cały import.** `scripts/source/captured_redirects.py:53-63`
- **Wyzwalacz:** przechwycona strona pod adresem aplikacji przekierowuje na żywą stronę, która nie jest stroną główną. Adresy aplikacji to `index`, `index.php`, `newsletter`, `zgloszenie`, `api`, `admin`, `media`, `_next`. Przykład: `/index.php` → `/sklep-nurkowy.html`. `discover()` jawnie pobiera `/index.php` (`public_capture.py:88`).
- **Co się dzieje:** `live` zawiera `FIXED_ROUTES` i `''`, ale nie zawiera tras aplikacji. Kod dopisuje więc rekord `redirects`, a `validateBundle` (`src/lib/import/bundle.ts:272`) odrzuca cały bundle. Odmowa jest bezpieczna, ale import nie przechodzi przez jedno przekierowanie, zamiast dostać jedno issue.
- **Poprawka:** przed `elif route_key(source) in live` dodać sprawdzenie `rk in {'index', 'index.php'} or rk.split('/')[0] in APP_ROUTES` → `code = 'source-http-redirect-app-route'`. W `content_parser.py` trzeba odtworzyć listę `APP_ROUTES` z `src/lib/source-routes.ts:30`.

**2. Sprawdzenie wolumenu nie jest dokładne.** `scripts/deploy/runtime-preview.py:52-53` (`REMOTE_RUN`)
- **Wyzwalacz:** kontener ma dodatkowy mount zagnieżdżony pod `/data`, na przykład `/data/preview` jako bind lub inny wolumen.
- **Co się dzieje:** filtr patrzy tylko na `Destination == '/data'`. Zagnieżdżony mount przechodzi, a `GUARD` sprawdza wyłącznie ścieżki w env. Wtedy `/data/preview/underwater-preview.db` może leżeć poza wolumenem `…-underwater-data`. Dziś Dockerfile nie deklaruje `VOLUME`, więc ryzyko powstaje tylko przy błędnej konfiguracji Coolify. Mimo to wymóg „exact mount” nie jest spełniony.
- **Poprawka:** wziąć wszystkie mounty, gdzie `Destination == '/data' or Destination.startswith('/data/')`. Wymagać, żeby był dokładnie jeden, z `Type == 'volume'` i `Name == app + '-underwater-data'`.

W kodzie auth, adaptera, testów, `public_capture.py` i `public_bundle.py` nie znalazłem żadnych innych błędów do naprawienia.

### Czego nie sprawdziłem
- Nie czytałem wnętrza `@libsql/client` (`Sqlite3Transaction.commit`/`rollback`), `keychain.py`, `src/lib/import/service.ts` ani konfiguracji Coolify. Format nazw obrazu i wolumenu przyjąłem tak, jak zakłada skrypt.
- Testy działają w jednym procesie. Między procesami serializację zapewnia `BEGIN IMMEDIATE` (domyślny tryb `write` w libsql), ale nie ma na to testu.
- Pominąłem, zgodnie z poleceniem, niezmienniki commerce, CMS i uploadu oraz dalszą logikę parsera.
