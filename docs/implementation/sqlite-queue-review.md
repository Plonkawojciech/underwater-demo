# Wspólna dzierżawa zapisu SQLite i propagacja błędów COMMIT

Stan: 2026-10-09, worktree `underwater-opus-ui-20261008`, gałąź `codex/underwater-ui-20261008`. Bez commita, buildu i deployu. Pliki do przeglądu i integracji przez roota:

- `src/lib/sqlite-adapter.ts` (nowy),
- `src/lib/commerce/transaction.ts` (przepisany helper finansowy),
- `src/payload.config.ts` (tylko import i wywołanie fabryki adaptera),
- `tests/integration.test.ts` (8 nowych testów, poprawione uruchamianie workera),
- ten dokument.

## Problem potwierdzony przed zmianą

Kod SDK, który to powoduje (Payload 3.90.2, `@payloadcms/drizzle` 3.90.2, drizzle-orm 0.45.2, `@libsql/client` 0.14.0 z łatką PRAGMA):

- `LibSQLSession.transaction()` w drizzle ignoruje `behavior` i woła `client.transaction()`, czyli zawsze `BEGIN IMMEDIATE`. Klient sqlite3 wykonuje BEGIN synchronicznie na bieżącym natywnym połączeniu, odpina je i otwiera nowe połączenie dla kolejnych zapytań. Każda transakcja ma więc osobne połączenie, a drugi BEGIN z tego samego procesu czeka w `busy_timeout` (5 s), blokując wątek Node. Właściciel blokady nie może się wtedy zakończyć, a czekający dostaje `SQLITE_BUSY`.
- Generyczny `beginTransaction` z SDK obserwuje transakcję przez `.catch(err => transactionFailed(err))`, więc obietnica `done` nigdy nie odrzuca. `session.resolve()` zwraca `done`, a `commitTransaction` dodatkowo łapie wyjątek. Nieudany COMMIT kończy operację CMS sukcesem.
- `getTransaction()` dla nieznanego ID sesji po cichu używa `adapter.drizzle`, czyli zapisu autocommit poza transakcją.
- Stara kolejka w `transaction.ts` szeregowała tylko wywołania helpera finansowego. Zwykłe `payload.create/update` jej nie znały.

Reprodukcja na niezmienionym kodzie, prawdziwy Payload i izolowana baza w `mkdtemp`, przebieg `tsx --test --test-name-pattern=…` (148 s):

| Test | Wynik przed zmianą |
|---|---|
| CMS `create` + `update` w trakcie transakcji finansowej trzymanej przez `await` | oba odrzucone: `cannot begin transaction: SQLITE_BUSY: database is locked`, 12,9 s, pętla zdarzeń zablokowana |
| 8 checkoutów + 8 `create` + 8 `update` CMS równolegle | 86,7 s, zapisy CMS z `SQLITE_BUSY` |
| Prawdziwie nieudany COMMIT (odroczony FK) w zwykłym `payload.create` | `Missing expected rejection`: fałszywy sukces |
| Zapis bez `req` wewnątrz helpera finansowego | 44 s (8 ponowień po 5 s busy), na końcu `SQLITE_BUSY` |
| Nieudany COMMIT helpera finansowego; nieudany BEGIN/ROLLBACK | przechodziły już wcześniej |

## Rozwiązanie

`leasedSqliteAdapter(args)` opakowuje `sqliteAdapter` z SDK i w instancji adaptera tej aplikacji podmienia `beginTransaction`, `commitTransaction`, `rollbackTransaction` i `destroy`. Nie zmienia globalnie Payload, drizzle ani libsql i nie dodaje łatki zależności.

- **Dzierżawa per plik bazy.** Każdy start transakcji w procesie (operacje CMS przez `initTransaction`, helper finansowy, import, migracje SDK) czeka w kolejce FIFO na jedną dzierżawę dla `path.resolve` ścieżki z `file:`. Rejestr leży w `globalThis`, więc przeładowany moduł i kilka instancji Payload na tym samym pliku dzielą dzierżawę. `:memory:` i adresy spoza `file:` mają dzierżawę per instancja.
- **Zwolnienie po faktycznym końcu.** Dzierżawa wraca dopiero po rozstrzygnięciu obietnicy `drizzle.transaction` (COMMIT, ROLLBACK albo nieudany BEGIN), niezależnie od wyniku. Zwolnienie jest idempotentne.
- **COMMIT nie kłamie.** `session.resolve()` zwraca prawdziwe `completion`. Nieudany COMMIT odrzuca `commitTransaction`, operacja Payload przechodzi do `killTransaction`, a drizzle już wykonało ROLLBACK. Commit niepustego ID, którego nie ma w rejestrze, rzuca błąd zamiast cicho kończyć się sukcesem. Payload woła commit wyłącznie przez `utilities/commitTransaction` i nie robi podwójnych commitów.
- **ROLLBACK.** `session.reject()` połyka tylko własny sygnał anulowania. Błąd prawdziwego ROLLBACK jest propagowany, a `killTransaction` w Payload i tak go połyka. Dzierżawa wraca w obu przypadkach.
- **Zagnieżdżenie.** Operacje z `req.transactionID` nie wołają `beginTransaction` (`initTransaction` zwraca `false`), więc nie czekają na dzierżawę. Helper finansowy uruchamia callback w `AsyncLocalStorage.run()`. Nowy BEGIN w tym kontekście (zapis bez `req` albo po `killTransaction` zagnieżdżonej operacji) od razu rzuca `…pass the caller req…` zamiast czekać na samego siebie. Nie używam `enterWith`: w Node 22 sonda pokazała, że wycieka do kontekstu najwyższego poziomu i do równoległych zadań.
- **Limit oczekiwania.** Czekający na dzierżawę dostaje po 15 s `WriteLeaseTimeout` (`code: UNDERWATER_WRITE_LEASE_TIMEOUT`). Komunikat celowo nie zawiera słów `busy`/`locked`, więc helper go nie ponawia. Chroni to przed zawieszeniem, gdy hook operacji CMS pisze bez `req`; takiego zagnieżdżenia nie da się wykryć.
- **Porzucona sesja.** Po 5 min trzymania watchdog robi ROLLBACK i zwalnia dzierżawę. W rejestrze zostaje zamknięta sesja, której `db` rzuca przy każdym użyciu. Bez tego `getTransaction` przełączyłby spóźnionego właściciela na autocommit. Zamknięta sesja znika przy jego commicie albo rollbacku. `destroy()` najpierw wycofuje otwarte sesje.
- **Helper finansowy** nie ma już własnej sesji ani kolejki. Wymaga adaptera z dzierżawą (`writeLease(payload.db)` rzuca błąd dla innego adaptera) i używa `payload.db.begin/commit/rollbackTransaction`. Zachowuje kontrolę `req.transactionID !== id` przed commitem, ROLLBACK po błędzie i ponawianie całej transakcji od BEGIN przy `SQLITE_BUSY` z innego procesu (8 prób). Nie wymaga już `DATABASE_URI`; klucz dzierżawy pochodzi z konfiguracji klienta adaptera.
- **Między procesami** nic się nie zmienia: arbitrem pozostaje `busy_timeout=5000` z łatki libsql. Dzierżawa jest tylko w procesie.

## Dowody po zmianie

- `pnpm typecheck`: exit 0.
- `tests/integration.test.ts`, cały plik, dwa ostatnie przebiegi: 24/24 (23 s i 34 s). Wcześniejsze przebiegi na tym samym kodzie: 23/23 bez testu wieloprocesowego, który padał wyłącznie przez opisaną niżej niestabilność środowiska.
- Nowe testy (wszystkie przechodzą):
  1. CMS `create` + `update` w trakcie trzymanej transakcji finansowej: wszystko się udaje w < 2 s, timer 10 ms tyka (≥ 5 razy), wynik obu stron zapisany, brak otwartych sesji.
  2. Mieszany ruch (8 checkoutów na 6 sztuk + 16 zapisów CMS): 6 zamówień, 2 odrzucenia `InputError`, stan 0, wszystkie 8 kategorii zapisane, 0 błędów CMS (było 86,7 s i `SQLITE_BUSY`).
  3. Prawdziwie nieudany COMMIT zwykłego `payload.create` (`PRAGMA defer_foreign_keys` + naruszenie FK sprawdzane przy COMMIT): odrzucenie `FOREIGN KEY`, kategoria nie istnieje, produkt bez zmian, kolejny zapis < 1 s.
  4. To samo dla `checkout`: stan i zamówienia wycofane, dzierżawa wolna, ponowienie z tym samym kluczem idempotencji daje jedno zamówienie.
  5. Wstrzyknięty nieudany BEGIN i nieudany ROLLBACK: błąd przekazany, 0 sesji, następny zapis < 1 s.
  6. Zapis bez `req` w callbacku helpera: odrzucenie w < 1 s (było 44 s), nic nie zapisane.
  7. Zapis bez `req` za transakcją trzymaną przez CMS: `WriteLeaseTimeout` po skróconym w teście limicie, właściciel commituje, ponowny commit tego ID rzuca `no longer open`.
  8. Porzucona sesja: watchdog (w teście 100 ms) wycofuje zapis, czekający pisarz przechodzi, spóźniony zapis właściciela z jego `req` rzuca błąd zamiast autocommitu, commit odrzucony, 0 sesji.
- Istniejące testy, w tym `a failed transaction completion cannot return a successful checkout` (wstrzyknięta awaria potwierdzenia COMMIT) i `independent application processes cannot sell the same last stock unit` (dwa osobne procesy): przechodzą.
- Sekwencyjnie (`--test-concurrency=1`): `content-safety`, `import`, `import-bundle`, `commerce`, `startup`, `backup`, `access`, `environment`: 48/48. `import` i `content-safety` używają `transaction()` (w tym rollback przy walidacji przekierowania).
- Pełne `tsx --test --test-concurrency=1 tests/*.test.ts tests/ui/*.test.ts`: 100 pass. 19 porażek w `source-content-parser.test.ts` (parser Pythona `scripts/source/content_parser.py`, bez bazy, obszar edytowany równolegle przez roota) i 24 anulowane w pliku integracyjnym przez niestabilny start opisany niżej. Przebiegi osobne powyżej.

## Niestabilność środowiska testów (istniała przed zmianą)

Przy load average ~23 (cudzy vitest i inne sesje) proces ładujący cały graf `src/payload.config.ts` przez hooki tsx (CLI `tsx` albo `node --import tsx`) czasem kończy się bez wyniku: `Detected unsettled top-level await` / `Promise resolution is still pending but the event loop has already resolved` albo exit 0 bez wyjścia. Test A/B z chwilowo przywróconym zwykłym `sqliteAdapter`: import configu 0/6 udanych, worker 3/8 udanych. Pojedyncze importy (`payload`, `@payloadcms/db-sqlite`, `sharp`, lexical i każdy moduł z configu osobno) przechodziły zawsze, więc problem dotyczy ładowania całego grafu, a nie konkretnego modułu.

Zmiany w teście z tego powodu:

- worker startuje przez `node --import tsx`, a nie przez CLI `tsx`;
- `childCheckout` powtarza start workera do 4 razy wyłącznie wtedy, gdy proces zakończył się kodem 0 bez wyniku. Taki proces nie zakończył checkoutu albo zakończył go przed wypisaniem wyniku. Powtórka z tym samym `idempotencyKey` zwraca istniejące zamówienie, więc nie może sprzedać drugiej sztuki;
- komunikat błędu workera zawiera końcówkę stdout/stderr.

Warto powtórzyć pełny zestaw na spokojniejszej maszynie albo na VM.

## Ograniczenia i ryzyka

- **CMS „Nie pamiętam hasła” nie działa i nie działało przed zmianą.** Payload 3.90.2 `forgotPassword` po `initTransaction` robi celowo zapis autocommit (`reservationReq.transactionID = undefined`, `reset_password_requested_at`). Ten zapis czeka na własny `BEGIN IMMEDIATE`. Sonda: czysty `sqliteAdapter` daje błąd `database is locked` po 5450 ms, nowy adapter po 5453 ms; w obu przypadkach 0 maili w outboxie i 0 sesji. Nawet bez tego zapisu (`minRequestInterval: 0`) `captureEmail` zapisuje outbox bez `req` wewnątrz transakcji `forgotPassword`, co teraz kończy się `WriteLeaseTimeout` po 15 s. Decyzja należy do roota: wyłączyć reset hasła w podglądzie albo zmienić `src/lib/email-capture.ts` i `Users` (np. zapis outboxa po commicie).
- **Zapisy autocommit poza `beginTransaction` nie są objęte dzierżawą.** Chodzi o `incrementLoginAttempts` przy błędnym logowaniu (Payload pisze celowo bez `req`), wspomnianą rezerwację w `forgotPassword`, `disableTransaction: true` i bezpośrednie `payload.db.*` bez `req`. Jeśli trafią na moment, w którym transakcja trzyma blokadę przez `await`, nadal mogą zablokować wątek do 5 s i skończyć się `SQLITE_BUSY`. Objęcie ich dzierżawą wymagałoby opakowania metod zapisu adaptera i dałoby samozakleszczenie w `forgotPassword`; świadomie poza zakresem.
- **Zagnieżdżony zapis bez `req` w hooku operacji CMS** czeka do 15 s i kończy się `WriteLeaseTimeout`. Wcześniej był to `SQLITE_BUSY` po 5 s z zablokowanym procesem. Wykrywanie natychmiastowe działa tylko w helperze finansowym.
- **Długie operacje CMS** (upload z `sharp`, masowe edycje) trzymają dzierżawę przez cały czas transakcji. Inne zapisy czekają w kolejce bez blokowania pętli; po 15 s dostają `WriteLeaseTimeout`.
- **Watchdog 5 min** wycofa transakcję trwającą dłużej, np. bardzo długą migrację w procesie aplikacji. Migracja jest atomowa, więc start przerwie pracę bez zmiany danych. Obecne migracje trwają milisekundy.
- **Między procesami** (aplikacja + `scripts/database/schema.ts` lub import w osobnym procesie) BEGIN nadal może blokować wątek do 5 s i dać `SQLITE_BUSY`. Helper finansowy ponawia, zwykła operacja CMS zwraca błąd tak jak wcześniej.
- **Payload: rollback zagnieżdżonej operacji.** Gdy operacja z cudzym `req` rzuci błąd, Payload wycofuje całą transakcję i usuwa `req.transactionID`. Jeśli hook połknie błąd i operacja-właściciel pisze dalej, zapisy idą autocommitem, a commit z `undefined` jest no-opem. To semantyka Payload; w helperze finansowym chronią przed tym strażnik ALS i kontrola `req.transactionID`.
- Oryginalny `beginTransaction` z SDK zapisywał w logu `cannot begin transaction: …`. Nowy przekazuje oryginalny błąd libsql bez dodatkowego wpisu w logu.
- Nie sprawdzono: buildu Next, realnego flow w przeglądarce, zachowania na VM pod ruchem i `next dev` z HMR (rejestr w `globalThis` powinien to obsłużyć, ale nie było testu).

## Diff

`src/payload.config.ts`, zmiana adaptera:

```diff
-import { sqliteAdapter } from '@payloadcms/db-sqlite'
 …
 import { validateEnvironment } from './lib/environment'
+import { leasedSqliteAdapter } from './lib/sqlite-adapter'
 …
-  db: sqliteAdapter({
+  db: leasedSqliteAdapter({
```

Argumenty adaptera (`transactionOptions`, `busyTimeout`, `wal`, `push: false`) bez zmian.

`src/lib/commerce/transaction.ts`: 14 wierszy dodanych, 69 usuniętych. Usunięte: `sessions`, `beginWrite`, `commit`, `rollback` i kolejka `underwaterWriteQueues` oparta na `DATABASE_URI`. Pętla ponowień korzysta teraz z `payload.db.beginTransaction/commitTransaction/rollbackTransaction` adaptera z dzierżawą, a callback działa w `holdingTransaction()`.

`src/lib/sqlite-adapter.ts`: nowy plik, 169 wierszy. Eksportuje `leasedSqliteAdapter`, `holdingTransaction`, `writeLease` (właściwości `waitTimeoutMs` i `maxHoldMs` zmieniają tylko testy) i `WriteLeaseTimeout`.

`tests/integration.test.ts`: import `createLocalReq`, `sql`, `writeLease` i `WriteLeaseTimeout`; helpery `failNextCommit`, `openSessions`, `quickWrite`; 8 opisanych wyżej testów; worker przez `node --import tsx` z ograniczonym ponawianiem.

Nie zmieniono `tests/transaction-worker.ts`, zależności, łatki libsql, migracji ani plików `.env*`.
