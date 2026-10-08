# Underwater — przegląd backendu koordynatora

Data: 8 października 2026. Recenzent: Claude Opus 5.5 (high). Przedmiot: niezacommitowane zmiany w `/Users/wojciechplonka/Programo/underwater-demo` względem `4a29273`, stan z chwili odczytu (koordynator nadal pracował; część plików pojawiła się w trakcie przeglądu).

## Zakres i ograniczenia

- Tylko odczyt plików narzędziem Read. `git -C … diff` było zablokowane przez sandbox dla katalogu spoza worktree, więc porównywałem pliki koordynatora z ich wersjami w moim worktree (tam są nietknięte od `4a29273`).
- Przeczytane: `payload.config.ts`, `proxy.ts`, `lib/{access,environment,http,html,preview-auth,upload,email-capture,actions}.ts`, `lib/commerce/{input,quote,order,provider,transaction}.ts`, `lib/forms/service.ts`, trasy `api/{store/quote,store/checkout,payments/test,payments/webhook,newsletter/confirm,health}`, kolekcje `Orders, Signups, Contacts, Newsletter, Outbox, Redirects, Media, Users, Pages, Trips, Albums, Events, CourseSessions, Products, Categories, Courses`, `commerceFields.ts`, `fields.ts`, `globals/Settings.ts`, `scripts/{start.sh,seed.ts,database/bootstrap-admin.ts}`, `Dockerfile`, początek `tests/integration.test.ts`.
- Nie czytałem: migracji, `PaymentAttempts`, `PaymentEvents`, `ImportRuns`, `newsletter/unsubscribe` (zakładam symetrię z `confirm`), `scripts/source/*`, reszty testów.
- Niczego nie uruchamiałem w repo koordynatora (ani testów, ani builda). Każde „potwierdzone” poniżej oznacza: wynika wprost z kodu. Rzeczy zależne od środowiska oznaczyłem jako ryzyko do sprawdzenia.

## Co jest zrobione dobrze

- Cena zamówienia liczona z katalogu na serwerze (`quote.ts:42-61`), cena z przeglądarki ignorowana; test integracyjny wysyła `price: 0.01` i oczekuje `totalCents` 1000 (`tests/integration.test.ts:22,42`).
- Idempotencja: unikalny `idempotencyKey`, porównanie odcisku danych w stałym czasie, ponowienie zwraca to samo zamówienie (`order.ts:55-59`); testy na równoległe ponowienie i ostatnią sztukę (`integration.test.ts:36-50`).
- Transakcje `BEGIN IMMEDIATE` z jawnym oczekiwaniem na COMMIT i ponowieniem przy `SQLITE_BUSY` (`transaction.ts`).
- Webhook: surowe bajty, limit 8 KB, HMAC przed jakąkolwiek zmianą, zgodność kwoty i waluty z próbą i zamówieniem, deduplikacja po `eventKey` z porównaniem skrótu treści (`webhook/route.ts`, `order.ts:88-110`).
- Prywatne kolekcje zamknięte na tworzenie z API i dodatkowo hookiem `serviceWrite` z kontekstem procesu (`commerceFields.ts:3-8`).
- Pierwszy administrator wyłącznie skryptem z poświadczeniem ze środowiska, odmowa gdy admin istnieje; `first-register` zablokowany hookiem w `Users.ts:17-21`.
- `start.sh` nie usuwa już bazy ani mediów i nie uruchamia seeda.
- Upload sprawdza faktyczny format przez `sharp`, bez SVG (`upload.ts`). Sanitizacja HTML z rozsądną listą znaczników, obrazy tylko z lokalnych ścieżek (`html.ts`).
- Poczta przechwytywana do `outbox`, także reset hasła z panelu (`email-capture.ts`); logi błędów bez danych (`http.ts:21-26`).

## Ustalenia

Priorytety jak w planie: P1 blokuje odbiór sklepu, P2 trzeba rozwiązać przed odbiorem lub świadomie przyjąć, P3 uwaga.

### U-1 (P1, potwierdzone) Cena promocyjna 0 sprzedaje produkt za darmo

`quote.ts:21-22`: `sale != null && sale < base ? sale : base`. Gdy `salePriceCents` (albo stare `salePrice`) ma wartość 0 (`salePriceCents` ma `min: 0`, `salePrice` nie ma ograniczenia; `Products.ts:30,36`), cena jednostkowa wynosi 0. Import mapujący brak promocji na 0 albo redaktor wpisujący 0 zamiast wyczyścić pole wystarczy, by checkout zarezerwował towar i utworzył zamówienie na 0 zł. UI pokazuje wtedy cenę regularną (traktuje 0 jako brak promocji), więc klient zobaczy rozbieżność dopiero w wycenie.

Poprawka: `sale != null && sale > 0 && sale < base`, plus test z `salePriceCents: 0`.

### U-2 (P1, potwierdzone) Wygasłe rezerwacje blokują wycenę

`expireReservations` wołają tylko `checkout`, `paymentSummary` i `acceptNotification` (`order.ts:54,81,90`). `/api/store/quote` jej nie woła (`quote/route.ts:8`). Scenariusz: ostatnia sztuka zarezerwowana przez porzucone zamówienie; po 30 minutach rezerwacja jest przeterminowana, ale `stock` nadal 0, więc wycena zwraca 409 „Brak wystarczającego stanu”. Interfejs nie pozwala złożyć zamówienia bez aktualnej wyceny, a karta produktu pokazuje „Chwilowo niedostępny”. Produkt jest martwy, dopóki ktoś nie otworzy linku płatności albo nie złoży innego zamówienia.

Poprawka: zwalnianie wygasłych rezerwacji w osobnym zadaniu okresowym albo w wycenie (w transakcji zapisu), test: rezerwacja z `expiresAt` w przeszłości, potem wycena tej samej sztuki.

### U-3 (P1 jeśli się potwierdzi, ryzyko środowiskowe) Izolacja hosta może odrzucić każde żądanie za proxy TLS

`proxy.ts:9` porównuje `request.nextUrl.origin` z `NEXT_PUBLIC_SERVER_URL`. Za Traefikiem w Coolify TLS kończy się na proxy; jeśli Next zbuduje `nextUrl` z protokołem `http` albo z wewnętrznym hostem/portem, każde żądanie dostanie 421 i cały podgląd przestanie działać. Nie sprawdzałem, jak `next start` 16.3 składa origin z nagłówków `X-Forwarded-*` w tej konfiguracji.

Sprawdzenie: jeden `curl -I` na wdrożeniu po zmianie. Odporniejsza wersja: porównywać `Host` / `X-Forwarded-Host` z oczekiwanym hostem i osobno wymagać `X-Forwarded-Proto: https`.

### U-4 (P2, potwierdzone) Porównanie originu na surowym napisie

`http.ts:18,39` i `proxy.ts:9` porównują z surową wartością `process.env.NEXT_PUBLIC_SERVER_URL`. `validateEnvironment` dopuszcza ścieżkę `/` (`environment.ts:36`), czyli `https://host/`. Z końcowym ukośnikiem wszystkie formularze, wyceny i zamówienia dostaną 403 (nagłówek `Origin` nigdy nie ma ukośnika), a proxy odrzuci każde żądanie. `cors`/`csrf` używają już znormalizowanego `runtime.serverURL`, więc te miejsca są niespójne.

Poprawka: jedna funkcja zwracająca `new URL(env).origin`, używana w proxy, `requireOrigin` i `actionOrigin`.

### U-5 (P2, prawdopodobne) `NEXT_PUBLIC_SERVER_URL` jest wkompilowany w build

Next podstawia `process.env.NEXT_PUBLIC_*` w czasie builda także w kodzie serwerowym. `Dockerfile:18` buduje z `https://underwater-demo.programo.pl`. Dosłowne odwołania w `proxy.ts:7`, `http.ts:18,39` i `forms/service.ts:57` dostaną tę wartość niezależnie od zmiennej w kontenerze; `validateEnvironment(process.env)` czyta ją dynamicznie. Ten sam obraz w innym środowisku (test, inna subdomena) odrzuci więc wszystkie zapisy. Mój UI ma tę samą zależność (`views/query.ts`, `siteOrigin`). Nie weryfikowałem buildem.

Poprawka: zmienna serwerowa bez prefiksu `NEXT_PUBLIC_` (np. `UNDERWATER_ORIGIN`) czytana w runtime; mogę dostosować `siteOrigin` po decyzji.

### U-6 (P2, potwierdzone) Drugi host przestanie działać

`CLAUDE.md` mówi, że działa też `underwater.programo.pl`. Po tych zmianach proxy zwróci tam 421, a CORS/CSRF dopuszczają tylko jeden origin (`payload.config.ts:60-61`). To zgodne z izolacją, ale trzeba to zapisać: przekierowanie DNS/Traefik na host kanoniczny albo usunięcie domeny i aktualizacja `CLAUDE.md`.

### U-7 (P2, potwierdzone) Miejsca na kursach można wyczerpać fałszywymi zgłoszeniami

`forms/service.ts:34-36` zwiększa `reserved` przy każdym zgłoszeniu z terminem. E-mail nie jest potwierdzany, nie ma deduplikacji tej samej osoby, pole `reservationReleased` (`Signups.ts:16`) nic nie zwalnia, a `Signups.access.update` to `() => false` (`Signups.ts:9`), więc obsługa nie może nawet oznaczyć zgłoszenia jako odrzuconego. Limit 5 na minutę na adres i 100 na minutę globalnie nie chroni przed wieloma adresami. Termin z 8 miejscami blokuje kilka żądań.

Poprawka do decyzji: zgłoszenie bez rezerwacji, a miejsce zajmuje obsługa przy zmianie statusu na „Zapisany”; albo rezerwacja tymczasowa z wygasaniem i zwolnieniem przy odrzuceniu.

### U-8 (P2, potwierdzone) Obsługa nie może zmieniać statusów zamówień i zgłoszeń

`Orders.ts:8`, `Signups.ts:9`, `Contacts.ts:4` mają `update: () => false`, a `serviceWrite` odrzuca zapis bez kontekstu procesu. Nikt z panelu nie ustawi „wysłane”, „skontaktowano” ani „zamknięte”. Plan (UW-03, UW-06) wymaga roli obsługi zamówień i oddzielenia statusu płatności od realizacji.

Poprawka: osobne pola realizacji/obsługi z dostępem `operations`/`admin`, z polami finansowymi i płatności tylko do odczytu.

### U-9 (P2, potwierdzone) Redaktor treści widzi dane osobowe

`privateSubmissionAccess.read` i `Orders.access.read` to `staffOnly` (`access.ts:21-26`, `Orders.ts:8`), więc rola `editor` czyta zamówienia, zgłoszenia i wiadomości z adresami i telefonami. Plan rozdziela redakcję treści od obsługi zamówień.

Poprawka: odczyt prywatnych kolekcji dla `admin` i `operations`.

### U-10 (P2 przed prawdziwym operatorem) Spóźniona wpłata po wygaśnięciu znika bez śladu dla obsługi

`order.ts:102-104`: płatność `paid` po wygaśnięciu albo zwolnieniu stanu zapisuje zdarzenie z `accepted: false` i kończy. Dla operatora testowego to poprawne. Przy prawdziwym operatorze oznacza to pobrane pieniądze przy anulowanym zamówieniu, bez flagi zwrotu i bez wpisu w outbox.

### U-11 (P2, do decyzji) Zmiana ceny między wyceną a zamówieniem przechodzi po cichu

`checkout` wycenia od nowa (`order.ts:60`) i nie porównuje wyniku z tym, co klient widział. Jeśli cena zmieni się w tym czasie, zamówienie powstaje z nową kwotą; klient zobaczy ją dopiero na stronie płatności. Propozycja: klient wysyła `expectedTotalCents` wyłącznie do porównania, serwer przy różnicy zwraca 409 z nową wyceną. UI przyjmie to bez zmian w kontrakcie odpowiedzi, bo po odrzuceniu i tak odświeża wycenę.

### U-12 (P3) Jeden sekret do trzech celów

`PAYLOAD_SECRET` podpisuje sesje Payload, webhook testowy i tokeny dostępu do płatności (`provider.ts:22-23,35`), a także token zdrowia (`preview-auth.ts:12`). Prefiksy rozdzielają dziedziny, więc nie widzę bezpośredniego ataku, ale rotacja jednego unieważnia resztę. Prawdziwy operator i tak przyniesie własny klucz.

### U-13 (P3) GET ze skutkami ubocznymi

`GET /api/payments/test` (`payments/test/route.ts:5`) otwiera transakcję zapisu (`expireReservations`). Limit to 600 na minutę globalnie, bez `requireOrigin`. Dla leniwego wygaszania to działa; przy U-2 lepiej przenieść wygaszanie do zadania okresowego.

### U-14 (P3) Media są publiczne niezależnie od publikacji treści

`Media.access.read: () => true`: `/api/media` wylicza nazwy plików i opisy także zdjęć przypiętych tylko do szkiców. W podglądzie chroni to Basic Auth; przed uruchomieniem publicznym warto ograniczyć listę (pojedynczy plik może zostać publiczny).

### U-15 (P3) Tokeny newslettera jawnym tekstem w outbox

`forms/service.ts:58` zapisuje linki z tokenami potwierdzenia i wypisu w treści wiadomości. Czyta je tylko admin, a to skrzynka testowa; produkcyjny adapter poczty nie powinien przechowywać treści z tokenami.

### U-16 (P3) Seed wpisuje niepotwierdzone treści

`scripts/seed.ts:123-127`: „od 1998 roku”, „gwarancja najniższej ceny”, „autoryzowany serwis”, zwrot różnicy w 14 dni, baner z 7 września; `:80-111`: ceny kursów, „grupa do czterech osób”, `nextDate` z września. UI pokazuje pola CMS tak, jak są (`heroTitle`, `heroText`, `priceGuarantee`, `includes`, `Course.price`). Seed jest dziś ręczny (`UNDERWATER_DEMO_SEED=1`), ale jeśli zostanie użyty na podglądzie, te treści wrócą na stronę.

### U-17 (P3) Testy UI nie wchodzą do `pnpm test`

`package.json`: `tsx --test tests/*.test.ts` nie obejmuje `tests/ui/`. Proponuję `tests/**/*.test.ts`.

## Nie znalazłem problemów w

Walidacji pozycji koszyka (`input.ts:22-30`), dopasowaniu wariantu (id albo jednoznaczne SKU, `quote.ts:12-17`), łączeniu duplikatów przed sprawdzeniem stanu (`quote.ts:50-52`), formacie tokenów (43 znaki base64url, porównanie przez skrót), odpowiedzi newslettera nieujawniającej istnienia adresu, limitach rozmiaru JSON, ograniczeniu nagłówka Basic i porównaniu w stałym czasie.
