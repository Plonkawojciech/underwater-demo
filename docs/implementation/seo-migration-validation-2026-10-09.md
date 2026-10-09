# Walidacja pakietu SEO, 9.10.2026

Zakres tej rundy: ponowne obliczenie adresów z zachowanego crawla i projekcji routingu, niezależna kontrola wszystkich opublikowanych 301 oraz przygotowanie kontraktu dla narzędzia migracji. Baza klienta, jego strona i DNS pozostają bez zmian. Kod nie uruchamia Payload ani zapisu DB.

## Podstawa i wynik

Praca zaczęła się na `5f20b59`. Odczytano plan domknięcia z 8.10, raport SEO, plan jakości oraz najnowszą listę rano z 9.10, 16:31 CEST. Nowy eksport zakończył się kodem 0 i potwierdził osiem SHA poprzedniej projekcji, crawla i wyników. Pokrycie pozostaje takie samo:

| Wynik offline | Liczba |
|---|---:|
| Dokładne stare URL, bez duplikatów | 6126 |
| `retained200` / `redirect301` | 5256 / 625 |
| `unresolved404` / `review` | 180 / 65 |
| Wszystkie sprawdzone opublikowane 301, w tym dwa spoza crawla | 627 |
| Osiągalne canonical w sitemap | 5227 |
| Decyzje z pustym celem / propozycje poza `routes` | 245 / 1 |
| Blokujące problemy reguł i sitemap | 0 |

`audit.safe` oraz `gates.ownPreviewRoutesReady` mają wartość true; dotyczą zapisanej projekcji, bez potwierdzenia wdrożenia/HTTP. `gates.clientCutoverReady` pozostaje false.

Walidator zachowuje dokładną pisownię starych adresów. Jeden URL PDF ma kodowaną ścieżkę; `originalPath`/`wirePath` przechowują ją obok dekodowanego klucza resolvera. Rejestr decyzji ma pusty cel i kod przyczyny z zachowanego raportu konwersji. Dwie opublikowane reguły spoza crawla trafiają do przekazania, a propozycja `/category/226-hippocampusbargibanti.html` → `/` pozostaje oddzielna.

Kontrola reguł nie polega wyłącznie na wybraniu pierwszego ID przez resolver. Zbiera również duplikaty i sprzeczne cele dla tego samego dekodowanego klucza. Każdy rekord musi prowadzić jednym krokiem do opublikowanego canonical; pętla, łańcuch, konflikt z treścią, inny canonical i prywatny cel blokują pakiet. Walidator rozwiązuje ponownie każdy adres sitemap.

## Dowody

Skupione testy SEO uruchomiono przez `/Users/wojciechplonka/.codex/bin/heavy`: `pnpm exec tsx --test tests/seo-migration-package.test.ts tests/seo-migration.test.ts tests/seo-consent.test.ts`. Wynik: 26/26 PASS, naturalny kod 0, bez pominięć, anulowań i retry, 9,587 s. Log: `evidence/underwater-seo-tests.log` w katalogu orchestratora na Mad Dog. Node 22.22.0, pnpm 10.33.0; użyto istniejących zależności zgodnych z lockfile, bez instalacji.

Typecheck i pierwotny eksport nie wystartowały w globalnej kolejce. Na polecenie prowadzącego zakończono wyłącznie własne wrappery PID 88284 i 15442 po sprawdzeniu pustych logów oraz dzieci `sleep 5`: oba exit 143. Typecheck ma status **NOT RUN**, podobnie pełny build i cały zestaw testów aplikacji; prowadzący konsoliduje te etapy po integracji worktree.

Następnie na polecenie prowadzącego wykonano lekką konwersję dokumentacji przez `pnpm exec tsx scripts/seo/validate-migration-package.ts`, z limitem heap 256 MB. Nie uruchamia ona CMS, przeglądarki ani transportu sieciowego. Testy nadal przeszły przez globalny wrapper. Eksport: naturalny kod 0; log `evidence/underwater-seo-export-light.log`. Dokładne argumenty odtworzenia zawiera instrukcja przekazania.

Wyniki znajdują się pod prefiksem `/Volumes/Mad Dog/Archive/codex-work/client-orchestrator-20261009/evidence/underwater-seo/migration-20261009`. Plik `.handoff.json` ma SHA256 `9c50e9b879635e5795df30cd4f3f3f1e3172dadafcbbfd04451e6304c30f6c6d`; `.proof.json` zawiera cztery SHA nowych wyników i tożsamość wejść. Pozostałe pliki to `.rows.json`, `.decisions.csv`, `.sitemap.xml`. Bez nowych żądań do klienta i bez zapisów DB.

Nowe regresje obejmują pełną listę opublikowanych reguł, dokładną ścieżkę kodowanego PDF, decyzje z pustym celem, propozycje poza `routes`, duplikat/sprzeczne cele, pętlę/łańcuch, konflikt z treścią, prywatny cel, canonical aliasu, query Joomli, bezpieczny sitemap i walidację projekcji bez pól klienta. Osobny przypadek sprawdza dokładne pary URL w dowodzie konfliktu źródeł.

## Granice i przekazanie

Nie wykonano nowego HTTP crawla, sprawdzenia Google, zmian bazy, odczytu bieżącego SQL ani migracji. Ten pakiet nie potwierdza aktualności stanów, treści czy kont klienta. Ochrona podglądu i runtime pozostają w istniejącym kodzie. Wynik offline nie zastępuje realnego odczytu 200/301/canonical po zastosowaniu finalnych reguł.

Końcowy cutover pozostaje zamknięty. Potrzeba bieżącego snapshotu SQL/pliki, rozstrzygnięcia pozostałych adresów, zastosowania zaakceptowanej propozycji na własnej kopii oraz nowego eksportu i kontroli HTTP. Dokładny kontrakt i polecenie odtworzenia opisuje [instrukcja przekazania](seo-migration-handoff-2026-10-09.md).

Nie uruchomiono serwera, przeglądarki ani własnej bazy. Po zakończeniu testów skrypty nie zostawiają procesów pomocniczych; dowody pozostają na Mad Dog.
