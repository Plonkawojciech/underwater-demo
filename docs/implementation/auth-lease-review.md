# Logowanie SDK a wspólna dzierżawa zapisu; przegląd poprawki resetu hasła

Stan: 2026-10-09, worktree `underwater-opus-ui-20261008`, gałąź `codex/underwater-ui-20261008`. Bez commita, buildu i deployu. Pliki tej części:

- `src/lib/sqlite-adapter.ts` (nowe przechwycenie `updateOne` dla kolekcji auth),
- `tests/auth-email.test.ts` (7 nowych testów; test resetu roota bez zmian w treści, poprawione dwa błędy typów),
- ten dokument.

`src/lib/auth-capture.ts` i `src/collections/Users.ts` przejrzane tylko do odczytu; należą do roota.

## Część 1. Przegląd poprawki `forgotPassword` (root)

Przepływ po poprawce (Payload 3.90.2, `dist/auth/operations/forgotPassword.js`): `initTransaction` → `beforeOperation` z `Users.ts` ustawia `disableEmail: true` i flagę `underwaterCMSResetCapture` → SDK pomija niezależną rezerwację `resetPasswordRequestedAt` (`reservationReq.transactionID = undefined`) i `sendEmail`, robi `findOne` i `payload.update` tokenu z `req` → `afterOperation` woła `capturePasswordReset(req, token)` w tej samej transakcji → COMMIT.

### Usterka: limit 15 s ujawnia istnienie konta

`src/lib/auth-capture.ts:16-18` rzuca `APIError(…, 429)`, gdy konto ma świeży `resetPasswordRequestedAt`. Dla nieznanego adresu operacja zwraca `null` bez błędu. Handler REST (`dist/auth/endpoints/forgotPassword.js`) odpowiada `200 {message: success}` po każdym rozwiązaniu operacji, a błąd idzie jako 429. Resolver GraphQL (`@payloadcms/graphql/dist/resolvers/auth/forgotPassword.js`, `/api/graphql` jest włączone) zwraca `true` albo błąd. Dwa żądania pod rząd na ten sam adres pozwalają więc odróżnić istniejące konto od nieistniejącego.

SDK robi to inaczej: zdławione żądanie nie spełnia `where` w rezerwacji, `user` jest `null`, operacja kończy się `return null` i odpowiedź jest taka sama jak dla nieznanego adresu (komentarz w kodzie SDK: „We don't want to indicate specifically that an email was not found”).

Waga: niska w obecnym podglądzie (runtime za prywatnym dostępem), istotna przy migracji do klienta, gdzie `/admin/forgot` będzie publiczne. Test roota (`tests/auth-email.test.ts:31`) utrwala obecne zachowanie (`error.status === 429`).

Kierunek naprawy do decyzji roota. Samo „zwróć `null` zamiast rzucać” w `afterOperation` nie wystarczy, bo SDK zdążył już nadpisać `resetPasswordToken` i `resetPasswordExpiration`. COMMIT unieważniłby wcześniej wysłany link i zostawił token, którego nikt nie dostał. Można w `beforeOperation` (działa już w transakcji) odczytać przez `req` stan konta i poprzedni token. Przy zdławieniu `afterOperation` przywraca poprzedni token i wygaśnięcie przez `payload.db.updateOne({ …, req })`, nie tworzy wpisu w outbox i zwraca `null`. Test 429 trzeba wtedy zamienić na: drugi wynik `null`, outbox nadal 1, poprzedni token działa w `resetPassword`.

### Sprawdzone i poprawne

- Atomowość limitu: odczyt i zapis `resetPasswordRequestedAt` dzieją się w transakcji `BEGIN IMMEDIATE`, więc są szeregowane w procesie (dzierżawa) i między procesami (blokada SQLite). Dwa równoległe żądania nie przejdą obu.
- Odrzucenie (429 albo błąd zapisu outbox) idzie do `catch` operacji → `killTransaction` → ROLLBACK cofa nowy token. `releaseRequestInterval` jest `null`, bo rezerwacja SDK nie wystartowała.
- `resetPasswordRequestedAt` ma w SDK `access.update: () => false`. Zapis działa tylko dzięki `overrideAccess: true` w `auth-capture.ts:19`; test potwierdza, że pole jest ustawione.
- `mailReq` dzieli `transactionID` z `req`. Błąd w `payload.create` outbox wywołuje `killTransaction(mailReq)`, które cofa wspólną transakcję. Późniejszy `killTransaction(args.req)` trafia na usuniętą sesję i kończy się bez błędu. Brak częściowego COMMIT.
- `disableEmail: true` z Local API pomija limit i przechwycenie, tak samo jak w SDK. REST i GraphQL nie przekazują `disableEmail`.
- Adres w wiadomości pochodzi z `validateEnvironment(process.env).serverURL`, a nie z nagłówka `Host`. Błędna konfiguracja kończy reset błędem i ROLLBACK.

Uwagi drobne (bez zmiany zachowania dziś): limit jest wpisany na sztywno (`15_000`), a nie czytany z `auth.forgotPassword.minRequestInterval`, który teraz nie jest ustawiony. Różnica czasu odpowiedzi między znanym a nieznanym adresem (zapisy i outbox kontra sam odczyt) istnieje też w SDK.

## Część 2. Nieudane logowanie podczas trzymanej transakcji

### Kod SDK, który to powoduje

`dist/auth/operations/login.js`: przy złym haśle `incrementLoginAttempts({ collection, payload, user })` jest wołane przed `initTransaction` i bez `req`. `dist/auth/strategies/local/incrementLoginAttempts.js` robi do czterech `payload.db.updateOne` bez `req` (komentarz SDK: zapisy mają być widoczne dla równoległych żądań w innych transakcjach): `$inc` licznika, ustawienie `lockUntil`, reset po wygasłej blokadzie i nadpisanie sesji przy blokadzie z równoległych prób. `getTransaction()` w `@payloadcms/drizzle` bez `transactionID` zwraca `adapter.drizzle`, czyli autocommit na wspólnym połączeniu klienta. Za trzymanym `BEGIN IMMEDIATE` z tego samego procesu taki UPDATE czeka synchronicznie `busy_timeout` (5 s) na wątku Node.

Inne zapisy auth (`resetLoginAttempts`, `addSessionToUser`, `revokeSession`, `logout`, `refresh`, `resetPassword`, `verifyEmail`, rehash hasła) przekazują `req`. Rezerwacja w `forgotPassword` jest wyłączona przez hook roota.

### Reprodukcja przed zmianą

Prawdziwy Payload, izolowana baza w `mkdtemp`, `pnpm exec tsx --test tests/auth-email.test.ts`, niezmieniony adapter, nowe testy:

| Test | Wynik przed zmianą |
|---|---|
| zły login w trakcie trzymanej transakcji finansowej (`transaction()`, 300 ms) | `Failed query: update "users" set … "login_attempts" = login_attempts + 1 …`, przyczyna `SQLITE_BUSY`, po 5523 ms; najdłuższa przerwa między tickami 10 ms: 5387 ms |
| to samo dla trzymanej zwykłej transakcji CMS (`beginTransaction` + `req`) | w izolacji to samo, ok. 7,2 s; w przebiegu po teście finansowym COMMIT holdera CMS padł po 112 ms z `SQLITE_BUSY: cannot commit transaction - SQL statements in progress` |
| 6 równoległych złych logowań za trzymaną transakcją | `Failed query … SQLITE_BUSY`, 5,6 s |
| udane logowanie po 2 złych, za trzymaną transakcją CMS | `SQLITE_BUSY: cannot commit transaction - SQL statements in progress` (holder) |
| zapis `users` z utraconym `transactionID` | `Missing expected rejection`: cichy autocommit |
| zły login wewnątrz `transaction()` bez `req` | 5,7 s, `SQLITE_BUSY` |
| 5 sekwencyjnych złych haseł bez trzymanej transakcji | przechodził |

Druga linia jest ważna: jeden nieudany login za trzymaną transakcją zepsuł COMMIT następnej, niezwiązanej transakcji w tym samym procesie. Hipoteza (niezweryfikowana w kodzie libsql): statement po `SQLITE_BUSY` zostaje niezresetowany na połączeniu klienta, a `client.transaction()` przejmuje właśnie to połączenie dla następnego `BEGIN`.

### Zmiana

`src/lib/sqlite-adapter.ts`, w `withWriteLease`, zastąpienie `adapter.updateOne`:

- kolekcja bez `auth` → oryginał bez zmian;
- `req.transactionID` (także obietnica, rozwiązywana tym samym `resolveID`) wskazuje otwartą sesję → oryginał w tej transakcji, bez dzierżawy i bez czekania na siebie;
- `req.transactionID` wskazuje sesję, której już nie ma → błąd (zamiast cichego autocommitu z `getTransaction`); sesja zamknięta przez watchdog nadal istnieje jako proxy i odrzuca zapytanie;
- brak transakcji i kod działa w `holdingTransaction` → natychmiastowy błąd, jak w `beginTransaction`;
- brak transakcji → `await lease.acquire()`, oryginalny `updateOne` w autocommit, `release()` w `finally`.

Sprawdzone w `@payloadcms/drizzle` 3.90.2 (wersja rozwiązywana przez `@payloadcms/db-sqlite` 3.90.2): `updateOne` → `upsertRow` używa `adapter.insert`/`adapter.deleteWhere` i `db.update/select/query`, nie woła `adapter.updateOne` ani `transaction()`. Dzierżawa nie jest więc brana drugi raz i nie powstaje zagnieżdżona transakcja. `$inc` przechodzi jako jeden `UPDATE … SET login_attempts = login_attempts + 1 RETURNING`, więc atomowość i widoczność między żądaniami zostają jak w SDK. Każde z czterech wywołań w `incrementLoginAttempts` bierze i oddaje dzierżawę osobno, więc nie jest ona trzymana przez `await` w kodzie SDK.

Nie zmieniłem: kolejności i semantyki COMMIT/ROLLBACK, watchdoga, `WriteLeaseTimeout`, `maxLoginAttempts: 5`, `lockTime`. Bez ponowień.

### Testy po zmianie

`pnpm exec tsx --test tests/auth-email.test.ts`: 8/8 (dwa przebiegi; drugi 11,9 s przy load average 23):

1. reset SDK roota: przechwycenie, 429, nieznany adres, brak dostępu `operations` do outbox, `resetPassword`, logowanie (bez zmian w logice);
2. zły login za trzymaną transakcją finansową: `AuthenticationError`, czas ≥ 250 ms i < 3000 ms (577 ms), przerwa event loopa < 1000 ms, `loginAttempts = 1`, holder zatwierdzony, 0 otwartych sesji;
3. to samo za trzymaną transakcją CMS (593 ms);
4. 5 sekwencyjnych złych haseł: licznik 1…5, `lockUntil` ≈ +15 min, potem dobre hasło → `LockedAuth`, złe → `LockedAuth`, licznik nadal 5;
5. 6 równoległych złych haseł za trzymaną transakcją finansową: każde `AuthenticationError` lub `LockedAuth`, licznik 6, `lockUntil` w przyszłości, dobre hasło → `LockedAuth`;
6. udane logowanie po 2 złych, za trzymaną transakcją CMS: token, licznik 0, `lockUntil` null, 1 zapisana sesja, 0 otwartych sesji;
7. `updateOne` na `users` z `req` w `transaction()`: widoczny w transakcji, < 1000 ms (bez czekania na siebie), ROLLBACK cofa; z utraconym `transactionID` → błąd `no longer open`, nic nie zapisane;
8. zły login wewnątrz `transaction()` bez `req` → natychmiastowy błąd (< 1000 ms), 0 otwartych sesji; następny zwykły zły login zapisuje próbę.

Próg przerwy event loopa ustawiłem na 1000 ms. Przy 200 ms test byłby wrażliwy na obciążenie maszyny, a busy-wait trwa ok. 5000 ms, więc 1000 ms nadal jednoznacznie odróżnia oba przypadki.

Regresja:

- `tests/integration.test.ts`: trzy przebiegi przy load average 17–35. Wyniki 23/24 (padł test 24, wieloprocesowy checkout), 23/24 (padł test 16, warunek `ticks >= 5`), 24/24. Test 24 osobno przechodzi (20 s). Żaden z nich nie zapisuje do `users`; nowe przechwycenie dotyka ich tylko odczytem `config.auth`. Uznaję to za niestabilność przy obciążeniu (komentarz przy `childCheckout` opisuje ten sam objaw), nie regresję. Wszystkie testy dzierżawy (16–23) przeszły w każdym przebiegu poza tym jednym przypadkiem testu 16.
- `tests/content-safety.test.ts` + `tests/import-bundle.test.ts` (dotykają `users`): 19/19.
- `pnpm typecheck`: bez błędów. Wcześniej `tests/auth-email.test.ts` miał dwa błędy typów w teście roota (`resetPassword` bez `overrideAccess`, `logged.user` możliwie `undefined`); poprawione bez zmiany zachowania. `tsc` z `incremental: true` przepisał `tsconfig.tsbuildinfo` (plik był już zmodyfikowany w drzewie).

Nieuruchomione: pełne `pnpm test` (polecenie: jeden przebieg naraz, testy plikami), build (polecenie: bez buildu), flow przeglądarkowy `/admin/login`.

### Sonda: równoległe złe logowania na koncie z sesją

Tymczasowy test (usunięty po pomiarze): konto loguje się raz poprawnie, potem 6 równoległych złych haseł, 5 rund. Każda runda: licznik 5 (nie 6), `lockUntil` w przyszłości, sesje 0. Przyczyna leży w SDK: gałąź „reachedMaxAttemptsForNextUser” w `incrementLoginAttempts` przy `useSessions` (domyślnie włączone) zapisuje cały nieaktualny obiekt `user` (`data: user`, z `loginAttempts = updated - 1` i `lockUntil` z odczytu sprzed prób). Jeden inkrement ginie; blokada w 5/5 rundach została utrzymana, bo późniejsza próba ustawia ją ponownie. Mechanizm wynika z kodu SDK i nie zależy od adaptera (adapter szereguje pojedyncze `updateOne`, a nie odczyt i zapis w SDK). Sondy na adapterze sprzed zmiany nie uruchamiałem. Nie naprawiałem tego.

## Granice, które zostają

- Dzierżawa działa w obrębie procesu. Między procesami nadal rozstrzyga `busy_timeout`; zły login w innym procesie za cudzą transakcją może tam zablokować wątek do 5 s i skończyć się `SQLITE_BUSY`, jak każdy zapis.
- Zły login, który czeka na dzierżawę dłużej niż 15 s, kończy się `WriteLeaseTimeout`, a nie `AuthenticationError`, i próba nie jest zapisana. Logowanie zostaje odrzucone.
- Zapis `users` bez `req` z wnętrza transakcji, która nie przeszła przez `holdingTransaction` (np. rezerwacja SDK w `forgotPassword`, gdyby hook roota zniknął), nie jest rozpoznawany jako zagnieżdżony. Czeka 15 s i kończy się `WriteLeaseTimeout`: błąd ograniczony w czasie, bez zawieszenia i bez busy-waitu.
- Fail-closed dla utraconej sesji dotyczy tylko `updateOne` na kolekcjach auth. Pozostałe kolekcje i metody (`create`, `deleteOne`, `updateMany`) zachowują fallback Payload do autocommitu przy nieznanym ID sesji, a surowe `payload.db.*` bez `req` na innych kolekcjach nadal mogą czekać w `busy_timeout`. Ogólne opakowanie nie było częścią zadania.
- Usterka enumeracji z części 1 zostaje do decyzji roota.
