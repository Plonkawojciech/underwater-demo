# Underwater: instrukcja CMS i izolowane E2E, 9.10.2026

Przygotowano dokładny kandydat [instrukcji klienta](../implementation/client-cms-guide.md) oraz siedem nowych scenariuszy E2E. **Nowe 14 E2E i pełny zestaw 50 E2E: NOT RUN w tym worktree.** Prowadzący polecił połączyć zakres CMS z migracją i SEO, a następnie wykonać jeden gate na integrowanym worktree. Kandydat pozostaje do review i pełnej weryfikacji; ten raport nie przedstawia statycznej kontroli jako dowodu operacji przeglądarkowej.

Baza i strona klienta pozostają poza tym przebiegiem. Wynik nie stanowi odbioru klienta ani potwierdzenia integracji z operatorem płatności.

## Zakres i decyzje

Uzupełniono instrukcję o role pracowników, kategorię, wyjazd, wybór zapisanego zdjęcia, obsługę zapytań i zgłoszeń oraz bezpieczne czynności przy zamówieniach. Zachowano adresy i identyfikatory przeniesionych treści; nie dodano przekierowań lub migracji schematu. Nie wprowadzono zmian runtime CMS.

Nowy `tests/e2e/client-operations.spec.ts` definiuje siedem scenariuszy na desktopie i mobile; poniższa tabela opisuje ich asercje, jeszcze bez wyniku wykonania:

| Scenariusz | Sprawdzane zachowanie |
|---|---|
| Role | Redaktor bez prywatnych danych i korekty magazynu; obsługa bez edycji treści; korekta obsługi dostępna i zapisana z wykonawcą w audycie; chroniona rola redaktora pozostaje bez zmiany. |
| Kategoria | Utworzenie szkicu, publikacja z publicznym 200, ukrycie bez usunięcia i publiczne 404. |
| Media i wyjazd | Upload JPEG z alt, wybór pliku w formularzu wyjazdu, publikacja, cena w groszach, lista bez podanej daty i zapis zapytania z kontekstem wyjazdu. |
| Nieznany stan | Brak zakupu, zapis zapytania z kontekstem produktu, brak zamówienia, niezmienione `stock=null`; czynność „Skontaktowano” z audytem i wyłącznie przechwycona wiadomość testowa. |
| Kurs | Rzeczywiste zgłoszenie rezerwuje miejsce; odrzucenie przez obsługę zwalnia je tylko raz. |
| Anulowanie | Checkout z przelewem testowym; anulowanie zwalnia towar tylko raz, zachowuje dane z checkoutu, bezpośrednia edycja zamówienia odrzucona. |
| Testowe opłacenie i nadanie | Oczekujący przelew nie pozwala na nadanie; testowe potwierdzenie przelewu i nadanie mają audyt; anulowanie opłaconego zamówienia zwraca 409. |

Istniejące E2E obejmują także produkt, aktualność, kurs i jego termin, kwoty z przecinkiem, walidację przed zapisem z klawiatury, upload oraz konflikty korekty magazynu, koszyk, wewnętrzną płatność testową, ochronę prywatnych rekordów i regresje wyglądu. Liczników wcześniejszych przebiegów nie sumujemy.

## Środowisko i dowody

Punkt wejścia: `5f20b59`, czysty przydzielony worktree `underwater_cms_e2e`. Wspólne `node_modules` pozostają bez zmian: Node 22.22.0, pnpm 10.33.0, Next 16.4.0, Payload 3.90.2, Playwright 1.64.0. Ciężkie polecenia przechodzą przez `/Users/wojciechplonka/.codex/bin/heavy`.

Harness przyjmuje `UNDERWATER_E2E_PORT=3062`; domyślne CI pozostaje na 3013. `UNDERWATER_E2E_ARTIFACT_ROOT` wskazuje prywatny katalog na Mad Dog. Każdy przebieg tworzy nowy katalog `underwater-e2e-*` z markerem własności, osobną SQLite, mediami i fixture. Przy podanym katalogu wynikowym cleanup kończy własne procesy i zachowuje bazę, media oraz `harness-cleanup.json`. Opcjonalny `UNDERWATER_E2E_REPORT_ROOT` umieszcza raport i trace poza checkoutem; domyślna ścieżka CI pozostaje bez zmian.

`scripts/qa/client-cms-gate.mjs` wykonuje build przez istniejący Webpack, typecheck i pełne E2E kolejno w jednym slocie. Osobny katalog `underwater-cms-gate-*` zachowuje logi, SHA plików testów i harnessu, kody etapów oraz rzeczywiste statystyki Playwright. Gate wymusza świeży własny serwer, bez `UNDERWATER_E2E_BASE_URL`.

Wykonane kontrole i pozostały gate:

| Weryfikacja | Wynik |
|---|---|
| Standardowy `pnpm build` | FAIL: Turbopack odrzucił symlink `node_modules` z Mad Dog poza swój filesystem root. Log zachowany w prywatnym `evidence/underwater_cms_e2e/build.log`; bez zmian zależności lub konfiguracji runtime. |
| Build przez istniejący Webpack | NOT RUN; root wykona po integracji |
| Pełny typecheck | NOT RUN; root wykona po integracji |
| Pełne istniejące i nowe E2E | NOT RUN; 36 istniejących + 14 nowych asercji/projektów = 50 zaplanowanych wykonań, bez sumowania historycznych PASS |
| Statyczna składnia JS | PASS, kod 0: `node --check scripts/qa/client-cms-gate.mjs` oraz `node --check scripts/qa/e2e-server.mjs` |
| Statyczna składnia TS | PASS: AST parser TypeScript nie wykazał błędów w configu Playwright, fixture i nowym specu; to nie jest typecheck |
| Treść, linki i diff | Sprawdzono nazwy pól z aktualnym źródłem kolekcji i komponentów; oba względne linki istnieją. `git diff --check` kod 0; brak zmian `src/` |
| Cleanup własnego serwera i procesów | Oba oczekujące wrappery zakończone kodem 143 przed startem poleceń; brak serwera, testowej bazy i katalogów gate. Własny gate 42768 miał wyłącznie dziecko `sleep`; zero jego outputów |

Osobny fallback build pozostawał w kolejce i nie wykonał `pnpm`; własny oczekujący wrapper 87864 zakończono SIGTERM, kod 143, przy pustym `build-webpack.log`. Zastąpił go pojedynczy gate build → typecheck → E2E. Root polecił przekazać kandydat do wspólnej integracji, więc zakończono również oczekujący wrapper 42768 / sesję 24853: SIGTERM, kod 143, wyłącznie dziecko `sleep` 23869 i zero katalogów/outputów `underwater-cms-gate-*`. Żaden serwer 3062 ani E2E nie wystartował. Nie zatrzymywano ciężkich zadań innych sesji.

Prywatne dowody: `/Volumes/Mad Dog/Archive/codex-work/client-orchestrator-20261009/evidence/underwater_cms_e2e/build.log`, `source-checks.json`, `queued-gate-cancellation.json` oraz `cleanup.json`. Końcowy odczyt: PID 87864/42768/23869 nie istnieją, `lsof` portu 3062 ma kod 1 i pustą listę listenerów, zero katalogów gate i baz `underwater-test.db`. Usunięto wyłącznie własny cache `.next` po nieudanym buildzie; zachowano logi i dowody. Nie otwierano przeglądarki ani kart GUI.

## Polecenie dla root po integracji

W `integrate_underwater`, po review wszystkich zakresów, uruchom jeden wspólny gate:

```sh
/Users/wojciechplonka/.codex/bin/heavy env \
  UNDERWATER_E2E_PORT=3062 \
  UNDERWATER_E2E_ARTIFACT_ROOT='/Volumes/Mad Dog/Archive/codex-work/client-orchestrator-20261009/evidence/integrate_underwater' \
  node scripts/qa/client-cms-gate.mjs
```

Nie uruchamiaj drugiego serwera Underwater. Gate sam przygotuje build, świeżą SQLite, marker, demo seed i syntetyczne konta `qa-admin`, `qa-editor`, `qa-operations` w domenie `example.invalid`. Domyślny Playwright ma jeden worker, desktop/mobile, zero retry, lokalny origin i kontrolę `test/internal-test/captured` przed każdym scenariuszem. Wynikowy `gate-summary.json` wskazuje naturalne kody, SHA wejść i statystyki, a `data/underwater-e2e-*/harness-cleanup.json` własne PID-y i zachowaną bazę.

Root wykona również pełne native oraz uzgodnione gate migracji i SEO. Nie powtarzano tu 353 testów native, ponieważ nie zmieniono runtime. Każdy błąd E2E lub P1/P2 wraca do autora przed integracją na main. Po rzeczywistym green root uzupełnia ten raport dowodem i usuwa oznaczenie kandydata z instrukcji.

## Granice i następny krok

Ta runda nie uruchamia adaptera konkretnego operatora, rzeczywistej poczty, nadania, zwrotu pieniędzy lub migracji klienta. Nie potwierdza bieżącego SQL, rzeczywistych stanów i miejsc, zatwierdzonych stawek lub dokumentów handlowych. Osobna, istniejąca lista dla Wojtka opisuje te decyzje. Scenariusz wyjazdu sprawdza rekord bez podanej daty; nowy test zamówień nie obejmuje pobrania, które instrukcja oznacza jako zależne od konfiguracji.

Git: kandydat na `orchestrator/20261009-underwater_cms_e2e`, wyłącznie przydzielone pliki. Finalny review, pełną weryfikację, integrację, CI i wdrożenie wykonuje root. Zmienione pliki: `docs/implementation/client-cms-guide.md`, ten raport, `tests/e2e/client-operations.spec.ts`, `scripts/qa/client-cms-gate.mjs`, `scripts/qa/e2e-fixtures.ts`, `scripts/qa/e2e-server.mjs` oraz `playwright.config.ts`.

## Poprawka po pierwszym rzeczywistym przebiegu integracji

Root uruchomił gate r3 w `integrate_underwater`. Odczyt istniejących artefaktów potwierdził pięć błędów nowych testów desktopowych; pełna macierz nadal trwała podczas tej diagnozy. Nie raportujemy 50/50 ani zamknięcia całej bramki.

- Test ról wysyłał do `/api/media` pusty JSON, który upload odrzucał kodem 400 przed sprawdzeniem uprawnień. Poprawka wysyła prawdziwy JPEG jako multipart z metadanymi i nadal wymaga 403 dla obsługi. Sprawdza również, że plik nie został zapisany jako rekord mediów.
- Helper czynności operacyjnych czytał body odpowiedzi po automatycznym przeładowaniu dokumentu przez CMS. Chromium tracił body; dodatkowe odświeżenie testu mogło też przerwać nawigację. Poprawka uzbraja oczekiwanie na przeładowanie przed kliknięciem, wymaga rzeczywistego POST 200, potwierdza trwały status przez API i dokładny polski status widoczny w odświeżonym formularzu. Tak samo synchronizuje korektę magazynu przed kolejnym logowaniem.

Dowody r3 pozostają w `/Volumes/Mad Dog/Archive/codex-work/client-orchestrator-20261009/evidence/integrate_underwater/final-gate-r3/cms/underwater-cms-gate-6Rdl7v/`: `e2e.log` oraz `test-results/client-operations-*/error-context.md` i `trace.zip`. Ślady pokazują POST czynności 200 i zmienione statusy; pięć nieukończonych scenariuszy nie stanowi dowodu ich pełnego wyniku. Odrębny, istniejący test `cms.spec.ts:329` zatrzymał się na dialogu Payload `document-stale-data`; diagnozę i artefakt przekazano prowadzącemu poza zakresem tej poprawki.

W tym worktree zmieniono tylko nowy spec E2E i raport. Poprawka nie uruchamia ciężkich poleceń, nie zmienia aplikacji, nie dodaje skipów lub retry. Statyczny parser TypeScript i `git diff --check` służą do kontroli kandydata; **E2E poprawki pozostaje NOT RUN** do kolejnego przebiegu prowadzącego na świeżej syntetycznej bazie. Trwającej integracji i jej dowodów nie modyfikowano. Nie uruchomiono własnego procesu, serwera ani przeglądarki.

## Wynik r3 i osobna poprawka testu magazynu

Końcowe `gate-summary.json` oraz `test-results/results.json` r3 dla integracji `028243a632bd3c64aaeaaca3655551e75467d900` potwierdzają build Webpack 0, typecheck 0 i E2E 1: **39/50 PASS, 11 FAIL, zero skips, zero flaky**. Desktop: 19/25; mobile: 20/25. Dziesięć błędów dotyczyło nowego helpera i niepoprawnego żądania mediów; osobny timeout wystąpił tylko na desktopie w istniejącym teście magazynu `cms.spec.ts:329`. Publikacja kategorii oraz upload, publikacja wyjazdu i zapytanie przeszły na obu projektach. Niewykonane końcowe asercje anulowania, jednokrotnego zwalniania i opłacenia nie mają jeszcze dowodu PASS.

Trace testu magazynu potwierdza zapis korekty 200, zachowaną niezapisaną nazwę i stan 3 w bazie. Payload wykrywa zmianę `updatedAt` podczas kolejnej edycji i pokazuje dialog `document-stale-data`. Próba kliknięcia zasłoniętego przycisku zapisu nie wysłała PATCH; timeout nie był dowodem odrzucenia przez API. Osobna poprawka testu jawnie czeka na ten dialog, sprawdza jego treść i zachowany szkic. Następnie wysyła rzeczywisty PATCH API ze stanem i wariantami sprzed korekty, wymaga 409 oraz ponownie potwierdza niezmienioną nazwę i bieżący stan 3. Nie wymusza kliknięcia, nie ukrywa dialogu i nie przeładowuje niezapisanego formularza.

Druga poprawka obejmuje tylko `tests/e2e/cms.spec.ts` i ten raport; build/typecheck/E2E jej wersji pozostają NOT RUN. Kontrola parserem TypeScript i diff nie zastępuje kolejnego pełnego gate. R3 zachowano bez zmian. `data/underwater-e2e-8zYN2o/harness-cleanup.json` potwierdza syntetyczny origin `localhost:3062`, zachowaną własną bazę i media oraz zatrzymane procesy 3934/4138/4194/4333; gate potwierdza `wrapperChildrenExited=true`. Baza klienta, live płatności, poczta i runtime produkcji pozostają poza dowodem.
