# Underwater — drugi przegląd zintegrowanego kodu

Recenzent: Claude Opus 5.5 (high). Przedmiot: pliki koordynatora w `/Users/wojciechplonka/Programo/underwater-demo`, czytane 8 października 2026 między 22:15 a 22:23 CEST. Koordynator nadal pracował, więc ten raport opisuje stan z tego okna, nie stan końcowy.

## Dowód wersji i ograniczenia

- Sandbox zablokował `git`, `diff` i `stat` dla katalogu koordynatora. Nie mam SHA ani czasów modyfikacji. Wszystko czytałem narzędziem Read/Grep, więc stan identyfikują konkretne linie:
  - `src/migrations/index.ts` ma cztery migracje, ostatnia `20261008_201114_underwater_signup_confirmations`;
  - `src/collections/Orders.ts:32` ma pole `paymentReviewRequired`, a `src/payload-types.ts:87,580` zawiera już `audit-events` i `paymentReviewRequired`;
  - `src/lib/commerce/order.ts` ma 134 linie, sprawdzenie `expectedTotalCents` jest w linii 62;
  - `package.json:13`: `tsx --test tests/*.test.ts tests/ui/*.test.ts`.
- Niczego nie uruchamiałem: testów, builda, migracji, serwera, sieci ani Keychain. Nie czytałem `.env*`, danych źródłowych ani archiwów. „Potwierdzone” znaczy, że wynika wprost z kodu. Zachowanie zależne od środowiska oznaczyłem jako „do sprawdzenia”.
- Przeczytane w całości: `lib/commerce/{order,quote,transaction,input}.ts`, `lib/{origin,http,access,operations,maintenance,catalog-validation,actions}.ts`, `lib/forms/{service,reservations}.ts`, `lib/import/{bundle,service}.ts`, `proxy.ts`, `instrumentation.ts`, trasy `api/{store/quote,store/checkout,payments/test,signups/confirm,operations/records}`, kolekcje `Orders, Signups, Contacts, AuditEvents, ImportRuns, Products, CourseSessions, Media, commerceFields`, trzy nowe migracje (+ grep po pierwszej), `scripts/import/import-bundle.ts`, `scripts/database/schema.ts`, `scripts/start.sh`, wszystkie sześć skryptów `scripts/source/*.py`, `tests/integration.test.ts`, `tests/transaction-worker.ts`, zmienione pliki UI (`CartPage`, `NewsletterToken`, `views/{query,resolve,shop}`, `[...slug]/page.tsx`, `zgloszenie/potwierdz`, `newsletter/[akcja]`, fragmenty `presentation.ts`). Pozostałe testy znam tylko z nazw.

## Najważniejsze

1. **N-1 (P1)** Brak migracji dla `audit_events` i `orders.payment_review_required`. Na bazie po `payload migrate` każde zapytanie o zamówienia skończy się błędem SQL, a to blokuje wycenę, checkout, płatność i worker.
2. **N-2 (P1)** Jedno wygasłe zamówienie z usuniętym wariantem blokuje wycenę dla wszystkich klientów i zatrzymuje worker.
3. **N-3 (P2)** Zapis produktu w panelu ze starego formularza nadpisuje stan magazynu zmniejszony w międzyczasie przez checkout.
4. **N-4 (P2)** Niepotwierdzone zgłoszenia na kurs dostają po 30 minutach status „Odrzucone”, także te bez terminu i te oznaczone „Skontaktowano”. W podglądzie dotyczy to praktycznie każdego zgłoszenia.
5. **N-5 (P2, do sprawdzenia jednym `curl`)** Mój `(site)/loading.tsx` może zamieniać 404 i przekierowania na odpowiedź 200, bo strumień zaczyna się przed rozstrzygnięciem adresu. Do tego `permanentRedirect` daje 308, a umowa obiecuje 301.

## U-1…U-17 z poprzedniego przeglądu

| ID | Stan | Dowód |
|---|---|---|
| U-1 cena promocyjna 0 | Rozwiązane po stronie serwera | `quote.ts:22` (`sale > 0`), `:23` odrzuca cenę 0; test `commerce.test.ts:41`. UI nadal pokazuje 0 zł, patrz N-7 |
| U-2 wygasłe rezerwacje blokują wycenę | Rozwiązane | Wycena wygasza w transakcji (`quote/route.ts:11-13`), worker co 60 s (`maintenance.ts`, `instrumentation.ts`). Nowe ryzyko: N-2 |
| U-3 izolacja hosta za proxy TLS | Rozwiązane w kodzie | `proxy.ts:10-12` porównuje nagłówek `Host` z hostem originu. Potrzebny `curl -I` na wdrożeniu. Healthcheck kontenera przez `localhost` dostanie 421 (`proxy.ts:12` działa przed sprawdzeniem tokenu zdrowia); sprawdzić konfigurację healthchecka w Coolify |
| U-4 origin jako surowy napis | Rozwiązane | `origin.ts:4` normalizuje przez `new URL().origin`; używają go `http.ts:19,40`, `proxy.ts:8` |
| U-5 `NEXT_PUBLIC_*` wkompilowane | Rozwiązane w kodzie | `origin.ts` czyta `env.UNDERWATER_ORIGIN \|\| env.NEXT_PUBLIC_SERVER_URL` przez parametr, czego Next nie podstawia w czasie builda. Buildem nie weryfikowałem |
| U-6 drugi host | Rozwiązane | `proxy.ts:13-17`: `underwater.programo.pl` → 308 na host kanoniczny. Działa, dopóki domena jest podpięta w Coolify |
| U-7 wyczerpanie miejsc | Częściowo | Rezerwacja trwa 30 minut, deduplikacja po (kurs, termin, e-mail), limit 5 na minutę na adres (`service.ts:31-34,47`, `actions.ts:19`). Wiele adresów nadal blokuje termin na 30 minut, a globalny limit 100/min (`actions.ts:17`) pozwala też zablokować formularze prawdziwym klientom. Patrz też N-4 |
| U-8 obsługa nie zmienia statusów | Rozwiązane w kodzie, zepsute przez N-1 | `operations.ts`, `api/operations/records`, `RecordActions.tsx`; zapis `audit-events` (`operations.ts:46`) trafi do nieistniejącej tabeli |
| U-9 redaktor widzi dane osobowe | Rozwiązane | `access.ts:22-27` (`operationsOnly`); Newsletter, Outbox, AuditEvents i ImportRuns tylko dla admina |
| U-10 spóźniona wpłata bez śladu | Rozwiązane w kodzie, zepsute przez N-1 | `order.ts:106-110` ustawia `paymentReviewRequired` i tworzy wpis w outbox; kolumny brakuje w migracjach |
| U-11 zmiana ceny między wyceną a zamówieniem | Rozwiązane | `order.ts:62`, `CartPage.tsx:147`; przy 409 klucz idempotencji zostaje, wycena się odświeża, duplikatu nie ma |
| U-12 jeden sekret do wielu celów | Pozostaje (P3) | `provider.ts:22-23`, `payment-registry.ts:12-14`, `preview-auth.ts:12` |
| U-13 GET ze skutkami ubocznymi | Pozostaje (P3) | `payments/test/route.ts:5` → `paymentSummary` otwiera transakcję zapisu i wygasza rezerwacje. Skoro działa już worker, odczyt może być tylko odczytem |
| U-14 media publiczne | Pozostaje (P3) | `Media.ts:9`; w podglądzie chroni Basic Auth |
| U-15 tokeny jawnym tekstem w outbox | Pozostaje (P3), zakres większy | Teraz także link potwierdzenia zgłoszenia na kurs (`service.ts:49`) |
| U-16 niepotwierdzone treści w seedzie | Pozostaje (P3) | `seed.ts:81,124-125`; zabezpieczone flagą `UNDERWATER_DEMO_SEED=1`, bez `--force` (`seed.ts:12-13`) |
| U-17 testy UI poza `pnpm test` | Rozwiązane | `package.json:13` |

## Zmiany w moim UI wprowadzone przez koordynatora

- `CartPage.tsx:147` wysyła `expectedTotalCents: quote.totalCents`. Kontrakt jest spójny z `order.ts:62`. Fingerprint klucza idempotencji (`CartPage.tsx:140`) nie obejmuje kwoty, więc ponowienie po 409 używa tego samego klucza. To bezpieczne, bo odrzucona transakcja niczego nie zapisała, a zamówienie przyjęte przy zgubionej odpowiedzi wraca po ponowieniu ze starą kwotą. Błędu nie znalazłem.
- `query.ts:75-77`: `siteOrigin()` korzysta z `runtimeOrigin()` i zwraca pusty napis, gdy origin nie jest ustawiony. Wtedy brakuje canonical i JSON-LD, a strona działa. Poprawnie.
- `shop.tsx:17-26` pobiera całe drzewo kategorii stronami po 500 (limit 100 000, czyli praktycznie bez limitu). Każda karta kategorii i produktu robi to raz na żądanie (`cache` z React). Przy kilkuset kategoriach VirtueMart to jedno zapytanie. Przy dużym katalogu warto dodać cache między żądaniami. P3.
- `NewsletterToken.tsx:5` i `zgloszenie/potwierdz/page.tsx`: potwierdzenie przez POST po kliknięciu, nie przy otwarciu linku, więc skanery poczty nic nie zmienią. Strona nie ma `metadata` (tytuł, `robots`). W podglądzie `noindex` i `no-referrer` dodaje `proxy.ts:7`, przed publicznym uruchomieniem trzeba je dopisać. P3.

## Nowe ustalenia

### N-1 (P1, potwierdzone w kodzie) Schemat bez migracji: `audit_events` i `orders.payment_review_required`

`payload.config.ts:44` rejestruje `AuditEvents`, `Orders.ts:32` dodaje `paymentReviewRequired`, a `push: false` (`payload.config.ts:52`). Grep po `src/migrations/*.ts` nie znajduje `audit_events`, `payment_review_required` ani kolumny `audit_events_id` w `payload_locked_documents_rels`. Typy (`payload-types.ts`) są już wygenerowane, więc `tsc` przejdzie i problemu nie pokaże.

Co się stanie: `start.sh` uruchomi migracje bez błędu i wystartuje aplikację. Adapter Drizzle wybiera wszystkie kolumny z definicji kolekcji, więc każde `find` na `orders` zakończy się błędem „no such column”. Wywołuje je `expireReservations` (`order.ts:31`) na początku wyceny, checkoutu, `paymentSummary`, webhooka i workera. Koszyk dostanie 500 przy każdej wycenie. Panel obsługi (`operations.ts:46`) padnie na braku tabeli `audit_events`, a blokady dokumentów w panelu mogą padać na brakującej kolumnie relacji. Test integracyjny (`integration.test.ts:31` migruje) powinien to wykazać, więc zgłoszone o 22:04 „30 testów zielonych” dotyczy stanu sprzed tych zmian.

Poprawka: `pnpm exec payload migrate:create` (albo `scripts/database/schema.ts create`), przegląd, że migracja tylko dodaje (`CREATE TABLE`, `ALTER TABLE ADD`), i ponowny pełny zestaw testów.

### N-2 (P1, potwierdzone) Wygasłe zamówienie z usuniętym wariantem blokuje sklep

`releaseOrder` → `reserveProduct(..., release=true)` rzuca `InputError 409`, gdy wariantu o zapisanym `variantId` już nie ma (`order.ts:17-18`). Zwalnianie rezerwacji nie ma obsługi błędu dla pojedynczego zamówienia (`order.ts:32-36`). Wyjątek wycofuje całą transakcję wywołującego, a jest nim każda wycena (`quote/route.ts:12`), checkout (`order.ts:55`), strona płatności (`:83`), webhook (`:92`) i worker (`maintenance.ts:13`, razem z `expireSignups` w jednej transakcji).

Scenariusz: klient składa zamówienie na rozmiar „M” i nie płaci. Redaktor usuwa w panelu wiersz „M” albo dodaje go od nowa (nowy identyfikator wiersza). Import z polem `variants` bez identyfikatorów daje ten sam efekt (`import/service.ts:11`). Po 30 minutach każda wycena zwraca „Stan wybranego wariantu zmienił się.”, nikt nie złoży zamówienia, worker co minutę zapisuje błąd, a wygaszanie zgłoszeń na kursy też stoi. Usunięcie całego produktu blokuje FK `orders_items.product_id NOT NULL … ON DELETE SET NULL` (migracja początkowa, linie 173 i 177), o ile SQLite ma włączone `foreign_keys`. Tego nie sprawdzałem.

Poprawka: przy zwalnianiu brakujący wariant nie może rzucać. Zamówienie trzeba oznaczyć do sprawdzenia (`stockReleaseIssue` albo `paymentReviewRequired`) i zamknąć. Każde wygasłe zamówienie przetwarzać osobno, żeby jedno nie blokowało pozostałych, a wycena nie powinna zależeć od zwolnienia cudzych rezerwacji. Test: zamówienie z wariantem, usunięcie wiersza, `expiresAt` w przeszłości, potem wycena innego produktu.

### N-3 (P2, potwierdzone w hooku; zachowanie formularza do jednego testu) Zapis ze starego formularza nadpisuje stan magazynu

`validateSession` odrzuca zmianę `reserved` spoza zaufanego procesu (`catalog-validation.ts:28`). `validateCatalog` nie ma takiej ochrony dla `stock` ani `variants[].stock` (`catalog-validation.ts:14-19`). Scenariusz: redaktor otwiera produkt ze stanem 5. Klient rezerwuje sztukę, stan spada do 4. Redaktor poprawia opis i zapisuje, a formularz Payload wysyła cały dokument, więc stan wraca do 5. Gdy zamówienie wygaśnie, zwolnienie doda jeszcze 1 i w magazynie będzie 6 sztuk, których nie ma. Ten sam efekt da import ze zmienionym `stock` (N-10).

Poprawka: stan zmieniany wyłącznie zaufanym procesem albo jako porównaj-i-ustaw (odrzucić zapis, gdy `data.stock` różni się od `originalDoc.stock`, a zapis nie zmienia stanu świadomie), osobna komenda „korekta stanu” z wpisem w audycie.

### N-4 (P2, potwierdzone) Niepotwierdzone zgłoszenia automatycznie „Odrzucone”

`signup()` zawsze ustawia `reservationExpiresAt` na 30 minut (`service.ts:47`), także bez terminu, czyli gdy żadne miejsce nie jest zajęte. `expireSignups` wybiera wszystkie niepotwierdzone i nie patrzy na status (`reservations.ts:6`), a potem nadpisuje go na `rejected` (`:13`). W podglądzie link trafia tylko do skrzynki testowej administratora, więc żaden klient go nie kliknie. Po 30 minutach każde zgłoszenie z formularza kursu ma w panelu status „Odrzucone”, nawet jeśli obsługa zdążyła oznaczyć je jako „Skontaktowano” (`operations.ts:40` nie ustawia potwierdzenia przy `contacted`).

Do tego: `enrolled` wpisuje `emailConfirmedAt` (`operations.ts:40`), czyli udaje potwierdzenie adresu, którego klient nie kliknął. Ponowne zgłoszenie tej samej osoby po odrzuceniu nadpisuje odrzucony rekord (`service.ts:48`), a historia zostaje tylko w audycie.

Poprawka: osobny status `expired` i zwalnianie wyłącznie miejsca, bez zmiany statusu obsługi; brak wygasania dla zgłoszeń bez terminu; osobne pole `staffConfirmedAt`. Kształt cyklu życia zgłoszenia trafia na listę decyzji.

### N-5 (P2, do sprawdzenia) `loading.tsx` a kody 404, 301 i 308

`src/app/(site)/loading.tsx` (mój plik) owija `[...slug]/page.tsx` w Suspense. `notFound()` i `permanentRedirect()` (`[...slug]/page.tsx:37,40`) działają dopiero po `resolveRoute`, a dokumentacja Next dla `loading.js` mówi, że po wysłaniu powłoki status 200 zostaje, a przekierowanie i 404 trafiają do treści (meta refresh i `noindex`). Jeśli tak jest w Next 16.3 z tą konfiguracją, stare adresy, których nie ma, odpowiedzą soft 404, a przekierowania z `redirects` zwrócą 200 z meta refresh zamiast 301. Plan wprost wyklucza soft 404 (`plan-domkniecia.md:284`).

Druga sprawa: `permanentRedirect` zwraca 308, przekierowanie drugiego hosta też 308 (`proxy.ts:15`), a umowa obiecuje 301 (`umowa-underwater-2026-09-29.html:211`). Mój `ui-review.md:184` błędnie pisał o 301. Google traktuje 308 jako trwałe przekierowanie, ale tekst umowy mówi 301.

Sprawdzenie: `curl -sI` na podglądzie dla nieistniejącego `/nie-ma-takiej-strony.html` i dla opublikowanego `redirects.from`. Poprawka: usunąć `(site)/loading.tsx` albo przenieść go do segmentów, w których nie ma `notFound` ani przekierowań. 301 można zwracać z `proxy.ts` przez `NextResponse.redirect(url, 301)` po odczycie tabeli przekierowań albo z route handlera.

### N-6 (P2, potwierdzone) Stałe sekcje zasłaniają źródłowe strony i ich SEO

`resolve.ts:61-62` sprawdza stałe sekcje (`sklep-nurkowy`, `kursy-nurkowania`, `kontakt`, `wyprawy`, `kalendarz`, `aktualnosci`, `relacje`, `galerie`) przed `legacyPath`. Metadane tych stron pochodzą ze stałej tabeli (`meta.ts:44,56`). Jeśli import przyniesie stronę `/wyprawy.html` albo `/kontakt.html` z własnym tytułem, opisem i treścią, nie będzie jej widać, importer tego nie zgłosi, a umowa obiecuje „zachowane tytuły i opisy”. To mój projekt resolvera. Poprawka: importer oznacza kolizje `legacyPath` ze stałymi sekcjami i stałymi trasami (`koszyk`, `newsletter`, `zgloszenie`, `platnosc-testowa`) jako nierozwiązane. Stała sekcja bierze tytuł, opis i wstęp z rekordu o tym `legacyPath`, gdy taki istnieje.

### N-7 (P2, potwierdzone) Cena 0 w UI i JSON-LD

`presentation.ts:173` traktuje 0 jako poprawną kwotę, więc produkt z ceną 0 (w VirtueMart to często „cena na zapytanie”) pokazuje „0,00 zł” na karcie i stronie produktu. Ma aktywny przycisk koszyka, a `productSchema` wystawia ofertę `price: "0.00"` (`presentation.ts:576-577`). Serwer słusznie odmawia (`quote.ts:23`), ale klient dowie się o tym dopiero w koszyku. To mój kod. Poprawka: `current === 0` oznacza „cena na zapytanie”, bez przycisku koszyka i bez `offers` w JSON-LD. Ten sam warunek obejmuje warianty.

### N-8 (P2, potwierdzone) Importer nie sprawdza typu celu relacji

`bundle.ts:40` sprawdza tylko, czy odwołanie istnieje w paczce. `service.ts:32-37` podstawia numeryczne ID bez sprawdzenia kolekcji. `products.category: "pages:o-nas"` albo `"media:x"` zapisze ID strony lub pliku jako ID kategorii. Jeśli kategoria o takim numerze istnieje, produkt po cichu trafi do złej kategorii, a FK tego nie wychwyci. Poprawka: mapa pole → oczekiwany prefiks (`categories.parent → categories:`, `products.images → media:`, `course-sessions.course → courses:`, `events.trip → trips:` itd.) sprawdzana w `validateBundle`.

### N-9 (P2, potwierdzone) Status `complete` importu mówi więcej, niż udowadnia

- `source.complete` deklaruje sama paczka. Paczka `public-pages` albo `demo` z `complete: true` i bez braków dostanie przebieg `complete` (`service.ts:98`), choć nie jest kopią bazy źródłowej. `manifestHash` jest sprawdzany tylko co do formatu (`bundle.ts:23`) i nie łączy się z zaszyfrowanym manifestem snapshotu.
- `runKey` to skrót samej paczki (`service.ts:62`). Ponowny import tej samej paczki po zmianie kodu importera (allowlista, sanitizer, mapowanie) albo po ręcznym usunięciu rekordów zwraca od razu `alreadyComplete` z wpisanym na stałe `sourceComplete: true` (`:64`) i niczego nie sprawdza.
- Dry run zwraca `unresolved: []` (`:61`), choć nie analizuje HTML, odwołań do mediów ani relacji. Pusta lista wygląda jak dowód braku problemów.

Poprawka: `complete` tylko dla `joomla-dump` ze zweryfikowanym manifestem; wersja importera w `runKey`; `alreadyComplete` sprawdza liczności w bazie; dry run zwraca `unresolved: null` z opisem „nie sprawdzono”.

### N-10 (P2, do decyzji) Import a żywy stan magazynu i miejsc

`stock` i `variants` są na allowliście aktualizacji (`service.ts:11`). Ponowny import nadpisuje stan zmniejszony rezerwacjami (N-3) i identyfikatory wierszy wariantów (N-2). Jednocześnie każda rezerwacja zmienia `updatedAt`, więc wykrywanie ręcznej edycji (`service.ts:83`) uzna każdy zamówiony produkt i każdy termin ze zgłoszeniem za „manual-edit”. Taki rekord nie zostanie już zaktualizowany, a przebieg nigdy nie dostanie statusu `complete`. Trzeba zdecydować, czy stan ze źródła wchodzi tylko przy pierwszym imporcie, czy przez osobną synchronizację.

### N-11 (P2) Kompletność snapshotu źródła

Tylko kod. Credentiali, Keychain ani archiwów nie dotykałem.

- Bez zapisu na źródle: `ReadOnlyFTP.putcmd` przepuszcza wyłącznie komendy odczytu (`ftp_readonly.py:15-25`), STOR i STOU są zablokowane, TLS weryfikuje certyfikat. Hasło i klucz idą przez Keychain i stdin (`start_snapshot.py:20-21`, `snapshot_worker.py:45-47`), nie przez argv, pliki ani logi. Logi zawierają tylko nazwy typów błędów. Szyfrowanie AES-GCM z losowym nonce, AAD to ścieżka albo URL. Tu błędów nie znalazłem.
- `inventory.py:20` wywołuje `LIST` bez `-a`. Wiele serwerów FTP ukrywa wtedy pliki z kropką, a wśród nich `.htaccess` z regułami SEF i przekierowaniami starej strony. Inwentarz pominąłby je bez śladu w `skipped`. Sprawdzenie: czy odszyfrowany inwentarz zawiera jakikolwiek wpis zaczynający się od kropki. Jeśli nie, użyć `LIST -a`, który pozostaje tą samą komendą odczytu.
- `inventory.py:67` łapie tylko `OSError` i `EOFError`. `ftplib.error_perm` (550 na katalogu bez dostępu) i `error_temp` (421, za dużo połączeń) przerywają cały przebieg bez zapisu postępu. Po wznowieniu ten sam katalog zatrzyma go znowu, więc inwentarz nigdy się nie zakończy. Poprawka: 550 do `skipped` z powodem, 4xx jak zerwane połączenie.
- `snapshot_worker.py:95`: ponowne połączenie jest w bloku `except`. Jeśli samo `connect()` się nie uda (odmowa połączenia, czyli błąd zaobserwowany wieczorem), wyjątek kończy cały przebieg. Manifest zapisuje się co 100 plików (`:98`), więc do 99 pobranych plików straci wpisy i zostanie pobranych ponownie. Danych to nie niszczy, ale marnuje transfer. Poprawka: ponawianie połączenia z odstępem i zapis manifestu w `finally`.
- `public_capture.py:94` nie łapie `ValueError` (strona powyżej 8 MB), `LookupError` (nieznany charset) ani `http.client.HTTPException`. Taki URL zatrzyma przechwytywanie przy każdym wznowieniu. Skrypt idzie tylko za linkami `.html` (`:59`), więc pomija adresy bez rozszerzenia i wszystkie obrazy. `complete_public_capture` będzie `false` na zawsze po jednym chwilowym błędzie (`:99`), nawet gdy późniejsza próba się uda. Ta kopia uzupełnia źródło, nie jest kopią serwisu i tak należy ją opisywać.
- Zakres danych: worker kopiuje wszystko pod `public_html`, `vmfiles` i `tylkopliki` poza `.env*` (`snapshot_worker.py:23`). Wejdzie więc także `configuration.php` Joomli z hasłem do bazy klienta i sekretem, a jeśli istnieją, kopie zapasowe (Akeeba `.jpa`, `.sql`) i logi z danymi klientów. Archiwum jest szyfrowane, ale to decyzja o zakresie (lista poniżej).
- `keychain.py:60-64`: gdy wpisu klucza nie ma, powstaje nowy, a istniejące archiwa przestają być odczytywalne. Skrypt kończy się błędem i niczego nie niszczy, ale komunikat nie wyjaśnia przyczyny. P3.

### N-12 (P2, potwierdzone) Rollback migracji zgłoszeń kasuje dane

`20261008_201114…ts:13-20` w `down` usuwa kolumny `email_confirmed_at`, `confirmation_token_hash`, `deduplication_key` i `reservation_expires_at`, czyli dowód potwierdzenia adresu. Dwie pozostałe nowe migracje w `down` celowo rzucają błąd (`194606…:393-394`, `195740…:58-59`). Poprawka: ten sam `throw`. Część `up` wszystkich trzech tylko dodaje tabele, kolumny i indeksy. Jedyny `UPDATE` (`194606…:311`) wypełnia nowe kolumny z istniejących danych.

### P3

- `quote/route.ts:11`: każda zmiana koszyka otwiera transakcję `BEGIN IMMEDIATE`. Ponowień jest 8 w sumie ok. 0,7 s (`transaction.ts:51-64`), więc przy ruchu wyceny zaczną zwracać 500. Skoro działa worker, wycena może tylko czytać, a wygasłe rezerwacje z `expiresAt <= now` liczyć jako wolne.
- `operations.ts:22`: anulowanie zamówienia z `paymentStatus: failed` nadpisuje je na `cancelled`. Powtórne `shipped` za każdym razem dopisuje audyt. Statusy końcowe nie mają strażnika.
- Importer: liczniki rosną wewnątrz funkcji transakcji, więc ponowienie po `SQLITE_BUSY` liczy rekord dwa razy (`service.ts:82-86`). Bajty mediów są czytane drugi raz po sprawdzeniu skrótu, bez ponownej weryfikacji (`:74`). Brak blokady dwóch równoległych importów tej samej paczki. `orderedEntities` ma złożoność kwadratową przy długich łańcuchach zależności (`bundle.ts:43-55`).
- `forms/service.ts:1,6`: podwójny import `runtimeOrigin`.
- Transakcje (`transaction.ts`): nieudany COMMIT przechodzi do wywołującego (`:36-42,57-59`), a sesja przerwana przez Payload kończy się błędem „aborted before commit”. Test (`integration.test.ts:110-120`) wstrzykuje błąd po faktycznym zatwierdzeniu i sprawdza, że ponowienie nie tworzy duplikatu. Prawdziwego wycofania COMMIT nie testuje, ale wtedy zamówienia po prostu nie ma, a ponowienie je tworzy. Test dwóch niezależnych procesów jest (`:140-146`). Brakuje testów: N-2, spóźnionej wpłaty z flagą, komend obsługi, wygasania i potwierdzania zgłoszeń.

## Bez zastrzeżeń

Autoryzacja `api/operations/records`: origin, sesja z Payload, rola sprawdzona na serwerze (`operations.ts:7`), odczyt z `overrideAccess: false`. Kolekcje finansowe są w panelu tylko do odczytu (`update/delete: false`), a `serviceWrite` blokuje zapis spoza procesu. Zwolnienie miejsca przy `rejected` i ponowne zajęcie przy `enrolled` z kontrolą limitu i daty (`operations.ts:29-39`) jest jednokrotne. Potwierdzenie zgłoszenia działa idempotentnie i wygasa (`reservations.ts:17-27`). Do tego: allowlisty pól i kolekcji importu, ścieżki mediów (realpath, odmowa symlinków, rozszerzenia, 12 MB, SHA-256 przed zapisem), `jsonLd` z escapowaniem, `safePaymentPath`, przekierowania tylko na lokalne ścieżki (`resolve.ts:87`). Zgoda na analitykę jest spójna, bo w podglądzie nie ładuje się żaden skrypt analityczny.

## Lista na rano (decyzje, bez pytań w nocy)

1. Kod przekierowań: 308 (domyślny w Next, Google traktuje go jako trwały) czy dosłownie 301 z umowy.
2. Cykl życia zgłoszenia na kurs: osobny status „wygasło” zamiast „odrzucone”; czy zgłoszenie bez terminu w ogóle wymaga potwierdzenia adresu.
3. Stałe sekcje kontra źródłowe strony pod tym samym adresem: przejmować tytuł, opis i wstęp ze źródła czy zostawić stałe.
4. Produkty z ceną 0: „cena na zapytanie” bez koszyka (moja rekomendacja) czy ukrycie.
5. Stan magazynu z importu: tylko przy pierwszym imporcie czy synchronizacja.
6. Zakres snapshotu: czy `configuration.php`, kopie zapasowe i logi z danymi klientów mają trafić do zaszyfrowanego archiwum, czy wykluczyć je przy kopiowaniu.
7. Czy przebieg importu z paczki `public-pages` może mieć status `complete`. Moja rekomendacja: nie.

## Czego nie sprawdziłem

Zachowania w przeglądarce, builda, testów, wdrożenia, statusów HTTP za Traefikiem, tego, czy SQLite ma włączone klucze obce, ani zawartości inwentarza i archiwów. Kopia publiczna i demo nie są kompletną kopią treści klienta. Dopóki nie ma dostępu do źródłowej bazy, raport uzgodnienia może opierać się wyłącznie na plikach FTP i stronach publicznych.
