# Migracja na izolowanej kopii lokalnej

`scripts/import/run-local-migration.mjs` uruchamia import wyłącznie na lokalnej kopii SQLite oznaczonej jako `test`. Domyślnie wykonuje dry-run. Wywołanie z `--apply-local` pozwala zapisać tylko tę kopię; skrypt nie ma polecenia wdrożenia u klienta, resetu ani usuwania rekordów. Zmiany schematu i pozyskanie SQL pozostają osobnymi etapami.

To warstwa nad istniejącym importerem Payload, a nie adapter surowego SQL Joomla. Bieżącego eksportu klienta nadal brakuje. Publiczny crawl oraz syntetyczna próba nie dowodzą kompletności produktów, kont, historii, cen lub stanów magazynowych.

## Wejścia

Wszystkie pliki wejściowe, kopia docelowa i raporty muszą należeć do jednego prywatnego katalogu dowodów, poza checkoutem i działającym `/data`. Katalogi źródła, celu i raportów nie mogą na siebie zachodzić. Skrypt odrzuca symlinki i pliki `.env*`; do źródła nie dodajemy FTP, konfiguracji Joomla ani sekretów.

Docelowy katalog zawiera istniejącą bazę `underwater-test.db`, `media/` oraz prywatny `.underwater-local-migration.json`:

```json
{
  "formatVersion": 1,
  "purpose": "local-migration-copy",
  "environment": "test",
  "clientWrites": false,
  "root": "ABSOLUTE_CANONICAL_TARGET_PATH",
  "isolationID": "UUID_FOR_THIS_COPY"
}
```

Marker służy kontroli wybranej kopii. Nie zastępuje kopii zapasowej, prawa dostępu do źródła ani zgody na migrację klienta. Docelowa baza musi mieć ledger wszystkich istniejących migracji projektu. Główny skrypt nie tworzy tabel i nie uruchamia `migrate()`.

CLI i harness wyłączają development `autoGenerate` dla typów Payload oraz import mapy panelu. Nie aktualizują `src/payload-types.ts` ani plików panelu podczas otwierania bazy. Dowód syntetyczny porównuje SHA wszystkich tracked plików projektu przed/po, pomijając wykluczone `.env*`.

Pakiet JSON ma następujące pola; wartości SHA obliczamy z faktycznych bajtów zachowanych plików:

| Pole | Znaczenie |
| --- | --- |
| `formatVersion: 1`, `clientWrites: false` | Wersja pakietu i jawna granica lokalnego zapisu |
| `scope` | `synthetic`, `public-capture` lub `database-export` |
| `versions` | `bundle: 1`, bieżący `importer`, SHA plików migracji i SHA `package.json` + lockfile; funkcja `currentVersions()` zwraca dokładny zestaw |
| `bundle: {path, sha256}` | Zweryfikowany DTO istniejącego importera, nie SQL |
| `sourceManifest: {path, sha256}` | Manifest zgodny z `bundle.source.manifestHash` |
| `mediaRoot` | Osobny katalog źródłowych obrazów/PDF, których SHA sprawdza importer |
| `handoff: {path, sha256}` | Pakiet offline SEO w formacie `scripts/seo/validate-migration-package.ts` |

Manifest źródła podaje `formatVersion: 1`, `kind`, `capturedAt`, `complete`, `databaseSnapshot`, `sourceVersions: {joomla, virtuemart}` oraz `coverage`. Dla syntetycznej próby wersje klienta są jawnie nieznane. `coverage.accounts` i `coverage.history` wymagają `knownTotal` (liczba lub `null`), `exported: 0`, `status: "not-imported"`; aktualny adapter nie przenosi tych prywatnych danych. Skrypt zgłasza to w każdym raporcie i zawsze pozostawia `clientCutoverReady: false` oraz `sourceComplete: false`. Osobne `publicBundleComplete` jest wyłącznie wynikiem istniejącego importera dla jego obsługiwanych kolekcji.

Pakiet SEO wymaga `deployOnClient: false`, docelowego origin `https://www.underwater.pl`, `audit.safe: true`, pustego `audit.blockingIssues` i `gates.ownPreviewRoutesReady: true`. Reguły muszą mieć status 301, zachować query i pochodzić z opublikowanych rekordów. Każdy opublikowany redirect w bundle musi mieć identyczne `from/to` w `handoff.routes`. Nierozstrzygnięte decyzje SEO pozostają w liczniku raportu; propozycja spoza zatwierdzonych reguł nie może wejść do importu.

## Uruchomienie i wznowienie

Runtime otrzymuje `PAYLOAD_SECRET` przez istniejące środowisko procesu. Nie przekazujemy sekretu w argv ani pakiecie. Pozostałe ustawienia skrypt wyznacza z oznaczonej kopii: środowisko `test`, lokalny origin, lokalna SQLite, przechwytywana poczta i wewnętrzne płatności testowe. Nie uruchamia serwera.

```sh
/Users/wojciechplonka/.codex/bin/heavy node scripts/import/run-local-migration.mjs \
  --work-root "$MIGRATION_WORK_ROOT" \
  --package "$MIGRATION_PACKAGE" \
  --target "$MIGRATION_TARGET" \
  --reports "$MIGRATION_REPORTS"
```

Wynik domyślny porównuje przed/po wszystkie tabele wraz ze schematem oraz zawartość wszystkich plików mediów. Każda różnica przerywa próbę. Bezpieczny zapis do własnej kopii dodaje `--apply-local`; importer ponownie wykonuje preflight, uzgadnia każdy klucz, chroni ręczne zmiany i nie usuwa rekordów spoza bundle.

Raporty są nowymi plikami z uprawnieniami 0600, UUID próby oraz etapami `preflight`, `applying`, `finished` lub `failed`. Nie nadpisują poprzednich checkpointów. Wznowienie dodaje `--resume "$MIGRATION_CHECKPOINT"` i musi pasować do SHA pakietu, wersji oraz identyfikatora tej samej kopii. Zawsze ponownie sprawdza źródło i aktualny stan bazy. Brak potwierdzenia poprzedniego zapisu nie uruchamia resetu; zapisany importer rozpoznaje już zaimportowane rekordy.

Blokada własnej kopii odmawia pracy równoległemu procesowi. Po przerwaniu martwego procesu zachowuje jego blokadę pod nową nazwą i serializuje odzyskiwanie. Nierozpoznanej lub nadal aktywnej blokady nie usuwa. Lease istniejącego importera też obowiązuje; przy twardym przerwaniu może wymagać odczekania jego terminu.

Raport pokazuje liczniki i SHA. Konflikty zawierają rodzaj oraz SHA identyfikatora zamiast treści/klucza rekordu. Szczegóły źródła i uzgodnienie konfliktów zachowujemy w prywatnym pakiecie. Po local apply skrypt porównuje hash istniejących kont, zamówień, zgłoszeń, kontaktów, newslettera, płatności i outbox; różnica kończy próbę błędem, zachowując kopię do diagnozy. Nie wykonuje automatycznego rollbacku ani kasowania.

## Powtarzalny dowód syntetyczny

```sh
/Users/wojciechplonka/.codex/bin/heavy node scripts/import/run-local-migration.mjs \
  --prove "/Volumes/Mad Dog/Archive/codex-work/client-orchestrator-20261009/artifacts/underwater_migration"
```

Harness tworzy nowy katalog z UUID oraz NOWĄ bazę, inicjalizowaną istniejącymi migracjami projektu. Zachowuje bazę, media, źródło, checkpointy i `proof.json`; sam kończy klienta SQLite, a runner usuwa tylko własne skompilowane moduły z `tmp/`. Próba obejmuje cztery syntetyczne encje, obraz, istniejące syntetyczne konto/zamówienie/kontakt, dry-run, replay, ręczną zmianę nazwy/stanu, konflikt i utratę potwierdzenia po realnym lokalnym zapisie. Log nie zawiera hasła syntetycznego konta ani sekretu runtime.

Wynik tej próby jest dowodem mechanizmu na sztucznych danych. Nie potwierdza importu aktualnej bazy klienta, zgodności dawnych haseł, operatora płatności, kompletności publicznego crawla lub gotowości do migracji na hosting klienta. Bieżące wejścia właściciela pozostają w `rano-dla-wojtka.md`: uprawniony aktualny SQL, sposób zachowania kont/historii i pierwszego logowania oraz zatwierdzone dane handlowe. Finalny hosting i migracja klienta wymagają osobnego zlecenia.

## Jedna końcowa bramka po integracji

Helper przyjmuje ścieżkę zamrożonego checkoutu, więc działa również po scaleniu do `integrate_underwater`. Wszystkie etapy mieszczą się w jednym zleceniu wrappera `heavy`. Uruchamia 9 testów kontraktu, typecheck, nową próbę syntetyczną oraz prawdziwe domyślne CLI na jej zachowanej bazie. Porównuje SHA tracked plików projektu przed/po całej bramce, a dla dry-run także wszystkie tabele i media. Sekret syntetyczny tworzy w pamięci i przekazuje tylko przez środowisko dziecka.

```sh
/Users/wojciechplonka/.codex/bin/heavy python3 \
  "$UNDERWATER_REPO/scripts/import/verify-migration-final.py" \
  --repo "$UNDERWATER_REPO" \
  --artifacts "/Volumes/Mad Dog/Archive/codex-work/client-orchestrator-20261009/artifacts/underwater_migration"
```

Jeżeli pipeline prowadzącego już uruchamia te same testy kontraktu i typecheck na tym samym kandydacie, można dodać `--skip-repo-checks`. Manifest zapisze wtedy `repoChecks: "delegated-not-attested"`; sukces helpera potwierdza tylko jego próbę syntetyczną i CLI. Dowód pełnego zestawu testów musi pochodzić z nadrzędnego pipeline. Żadne pominięcie nie jest raportowane jako test zaliczony.

Każdy przebieg zachowuje nowy katalog `final-gate-UUID` z `manifest.json` oraz logami etapów. Manifest zawiera exit codes, SHA logów, odnośnik do pełnego `proof.json` i checkpoint rzeczywistego dry-run CLI. Nie zawiera środowiska ani danych klientów. Dokładny stan dotychczasowych dowodów, anulowanego wrappera i pozostałych bramek znajduje się w [checkpoincie zadania](../orchestration/2026-10-09-underwater_migration.md).
