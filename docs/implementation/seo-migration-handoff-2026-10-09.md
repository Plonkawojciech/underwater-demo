# Pakiet adresów SEO do późniejszej migracji

Ten etap przygotowuje pliki i sprawdza zapisane dane. Nie uruchamia migracji klienta, nie pobiera nowych stron i nie zapisuje bazy. Podstawą jest projekcja routingu z 9.10 oraz zachowana lista crawla. Brak bieżącego SQL nadal wyklucza potwierdzenie kompletności witryny.

## Co przekazujemy

`scripts/seo/validate-migration-package.ts` ponownie oblicza mapę wspólnym resolverem aplikacji, sprawdza osiem hashów poprzedniego eksportu i audytuje każdy opublikowany rekord 301. Eksport 625 reguł z listy crawla nie obejmował dwóch opublikowanych adresów spoza tej listy; nowy `routes` obejmuje również te rekordy.

Walidator zachowuje `oldUrl`, `originalPath` i `wirePath` oraz osobno podaje `oldPath`, czyli dekodowany klucz resolvera. W zapisanych danych znajduje się jeden kodowany URL PDF. Te pola pozwalają porównać oryginalny adres z rzeczywistym adresem żądania bez zamiany starej pisowni na nowy slug. Zachowane ścieżki 200 nie otrzymują przekierowań do siebie.

Każdy adres bez potwierdzonego celu otrzymuje decyzję z `proposedDestination: null`. Kody przyczyn pochodzą z raportu konwersji, w tym dokładnych par URL zapisanych przy konflikcie źródeł. Podobna nazwa lub numer produktu nie wystarczają do utworzenia 301. Jedna propozycja oparta na zapisanym HTTP pozostaje w `proposals`, poza regułami do zastosowania.

## Format dla narzędzia migracji

Główny plik `<prefix>.handoff.json` ma `formatVersion: 1`, `targetOrigin: https://www.underwater.pl` i `deployOnClient: false`. Narzędzie migracji wskazuje go przez `{ "handoff": { "path": "…", "sha256": "…" } }` i weryfikuje hash przed odczytem.

| Pole | Znaczenie |
|---|---|
| `routes` | Wszystkie bezpieczne, opublikowane rekordy `{ from, to, status: 301, queryPolicy: "preserve", source: "published", recordId }`. `from` i `to` zachowują wartości rekordu. Cel musi prowadzić jednym krokiem do końcowego canonical. |
| `builtInRoutes` | Osobny kontrakt istniejącego zachowania `/index.php` → `/`, wyłącznie bez query. To nie jest dodatkowy rekord CMS. |
| `decisions` | Nierozstrzygnięte i wymagające review adresy z przyczyną, wymaganym dowodem i pustym celem. Blokują końcowy cutover, nie zastosowanie sprawdzonych reguł na własnej kopii. |
| `proposals` | Udokumentowane sugestie. Nie należą do `routes`; wymagają zastosowania na własnej kopii oraz nowego odczytu/eksportu. |
| `audit.safe`, `audit.blockingIssues` | Wynik kontroli wszystkich rekordów 301 oraz każdego adresu sitemap. Dwa cele tego samego klucza, duplikat, pętla, łańcuch, niebezpieczny cel, konflikt z treścią i inny canonical blokują przekazanie reguł. |
| `gates.ownPreviewRoutesReady` | Zgadza się z `audit.safe`. Dotyczy zgodności reguł w zapisanej projekcji; nie dowodzi ich zastosowania ani HTTP. |
| `gates.clientCutoverReady` | Zawsze `false` na tym etapie. Brak aktualnego snapshotu i osobnej autoryzacji migracji klienta. |
| `inputs`, `baseline` | Tożsamość wejść i dowód zgodności z ośmioma wcześniejszymi hashami. Zmienione wejście wymaga nowego eksportu i rozliczenia różnicy. |

Pozostałe pliki: `.rows.json` zawiera cały inwentarz adresów; `.decisions.csv` służy do rozstrzygania braków; `.sitemap.xml` to materiał do kontroli; `.proof.json` zapisuje SHA wszystkich czterech wyników. Pliki mają prawa `0600`, a istniejący prefiks powoduje przerwanie eksportu. Pełne adresy i prywatne ścieżki dowodów zostają poza Git.

## Odtworzenie eksportu

Polecenie działa z repo, na istniejących danych. Katalog wynikowy musi znajdować się na zamontowanym Mad Dog. Zastąp `NOWY-PREFIKS` nową nazwą; walidator nie nadpisuje wcześniejszych wyników.

```sh
/Users/wojciechplonka/.codex/bin/heavy pnpm exec tsx scripts/seo/validate-migration-package.ts \
  --projection /Users/wojciechplonka/Programo/underwater-private/20261009-quality-round/seo-projection.json \
  --crawl /Users/wojciechplonka/Programo/underwater-private/20261009-quality-round/crawl-urls.json \
  --baseline-proof /Users/wojciechplonka/Programo/underwater-private/20261009-quality-round/migration-map-final-v2.proof.json \
  --source-report /Users/wojciechplonka/Programo/underwater-private/20261008-import-public/conversion-report.json \
  --out-prefix '/Volumes/Mad Dog/Archive/codex-work/client-orchestrator-20261009/evidence/underwater-seo/NOWY-PREFIKS'
```

Kod 0 potwierdza zgodność offline, a kod 2 oznacza zapisany pakiet z blokującym audytem. Błąd hasha, wejścia lub istniejącego prefiksu przerywa operację. Raport konwersji daje przyczyny dla tej zapisanej wersji, a nie dowód aktualności danych klienta.

## Query, canonical i prywatny podgląd

Istniejący proxy zachowuje query przy ścieżkowym 301. Adapter nie może zastąpić tego zachowania odrzuceniem parametrów. Adres starej Joomli zawierający `?option=…&id=…` wymaga oddzielnej mapy dokładnego query; nigdy nie stosujemy do niego ścieżkowej reguły `/index.php` → `/`. Fragment przeglądarki nie dociera do serwera, więc nie jest źródłem reguły HTTP.

Sitemap zawiera wyłącznie osiągalne, opublikowane canonical. Walidator ponownie rozwiązuje każdy adres, kontrolując 200, ten sam canonical i brak przekierowania. Nie dodaje prywatnych kolekcji, PDF API, dat `lastmod` ani aliasów. Metadane aplikacji dopuszczają tylko paginację `strona=2`–`1000`; wyszukiwanie i tokeny nie wchodzą do canonical.

Prywatny podgląd zachowuje uwierzytelnienie, `robots.txt: Disallow: /`, `X-Robots-Tag: noindex, nofollow, noarchive` i `Cache-Control: private, no-store`. XML z domeną klienta jest plikiem do przyszłego przekazania; aktualny endpoint podglądu korzysta z własnej domeny. Pakiet nie zmienia ochrony, metadanych ani robots aplikacji. Istniejące testy runtime i proxy sprawdzają te zachowania na bazie syntetycznej, a wynik tej rundy opisuje [raport](seo-migration-validation-2026-10-09.md).

## Następny etap po dostarczeniu źródła

Po pozyskaniu bieżącego SQL uzgodnić 245 decyzji z rekordami i snapshotem plików. Zachować historię każdej zmiany; usunięta treść wymaga świadomej decyzji o jej zachowaniu lub prawidłowym statusie, bez zbiorczego przekierowania na stronę główną. Źródłowe formularze kont wymagają też decyzji o ciągłości kont.

Na własnej kopii zastosować wyłącznie zaakceptowane reguły, odczytać finalną projekcję routingu i wykonać nowy eksport. Przed późniejszym cutover sprawdzić HTTP każdego dokładnego starego URL: status, Location, końcowy status i canonical; osobno query, Unicode/PDF, GET/HEAD oraz brak pętli/łańcucha. Kontrola sitemap i prywatnych adresów pozostaje obowiązkowa. Dopiero osobno zlecona migracja klienta rozstrzyga końcowy hosting, indeksowanie, istniejące GA/GSC i DNS.
