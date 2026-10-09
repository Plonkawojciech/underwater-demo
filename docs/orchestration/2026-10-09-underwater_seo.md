# Checkpoint underwater_seo, 9.10.2026

Cel: przygotować sprawdzony pakiet wszystkich zapisanych starych adresów i opublikowanych 301 do późniejszej migracji, z jawnymi brakami. Własny worktree `underwater_seo`, branch `orchestrator/20261009-underwater_seo`, baza `5f20b59`. Oryginalny checkout i prywatne źródła pozostają tylko do odczytu.

Decyzje: nie wymyślamy celów dla brakujących URL. Publikowane 301 i propozycje mają oddzielne pola. `audit.safe` i `gates.ownPreviewRoutesReady` dotyczą kontroli offline, podczas gdy `gates.clientCutoverReady` pozostaje false. Migrator otrzyma kontrakt `{handoff:{path,sha256}}`; jego skrypty należą do innego wykonawcy.

Zmiany: `scripts/seo/migration-package.ts`, `scripts/seo/validate-migration-package.ts`, `tests/seo-migration-package.test.ts`, dokumentacja przekazania oraz raport walidacji. Nie zmieniamy schematu, runtime, danych ani istniejących narzędzi importu.

Dowód testów: 26/26 PASS w trzech plikach SEO, naturalny kod 0, bez pominięć/anulowań, 9,587 s; Node 22.22.0 i pnpm 10.33.0. Log na Mad Dog: `evidence/underwater-seo-tests.log`. TC NOT RUN: prowadzący zlecił odwołanie kolejkujących wrapperów PID 88284/15442 po potwierdzeniu tylko `sleep 5` i pustych logów; exit 143. Pełny pipeline należy do integracji prowadzącego.

Eksport dokumentacyjny offline, heap 256 MB: exit 0, 6126 URL (5256 zachowanych, 625 301, 180 unresolved, 65 review), wszystkie 627 opublikowanych reguł oraz 5227 sitemap canonical bez blokad, 245 decyzji, 1 oddzielna propozycja, osiem zgodnych SHA poprzedniego pakietu. Handoff `evidence/underwater-seo/migration-20261009.handoff.json` na Mad Dog; SHA256 `9c50e9b879635e5795df30cd4f3f3f1e3172dadafcbbfd04451e6304c30f6c6d`. Kontrakt/path/SHA przekazano migratorowi i reviewerowi. Nie ma własnego serwera, przeglądarki lub DB; konwersja zakończona.

Git: dokładnie sześć własnych plików, bez zmian schematu/runtime i cudzych zmian. Następny krok: prowadzący integruje scoped commit, wykonuje typecheck/pełne testy/build oraz sprawdza pakiet migratorem. Końcowa migracja klienta czeka na aktualny SQL/snapshot i decyzje z listy; nie ma autoryzacji DNS lub indeksowania.
