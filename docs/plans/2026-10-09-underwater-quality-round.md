# Runda jakości: wydajność, dostępność, SEO, CMS i CI

Zakres zlecony 9.10.2026. Punktem odniesienia jest commit `945d5ac`. Prace i testy dotyczą wyłącznie własnego podglądu Programo, jego izolowanej kopii i danych syntetycznych. Baza, FTP, DNS i działająca strona klienta pozostają bez zmian.

1. Zamrozić punkt odniesienia: osobna kopia zweryfikowanego odtworzenia bazy i mediów, testowe konta i oferta do koszyka. Zapisać tożsamość obrazu, fixture i narzędzi.
2. Zmierzyć sześć ścieżek: strona główna, kategoria, produkt, kurs, koszyk i checkout. Trzy zimne przebiegi Lighthouse mobile na ścieżkę; osobne pomiary rzeczywistych interakcji Event Timing. LCP < 2,5 s, CLS < 0,1 i INP < 200 ms to cel. Dane laboratoryjne nie potwierdzają terenowego p75.
3. Usunąć potwierdzone problemy z obrazami, przesunięciami układu i dostępnością. Połączyć axe z ręczną kontrolą klawiatury, fokusu, błędów formularzy, powiększenia i szerokości 320 px. Opus 5.5 high ocenia wygląd i końcowy diff; prowadzący odbiera uwagi.
4. Przygotować pełny rejestr adresów z istniejącego crawla. Zachowane ścieżki zwracają 200; właściwe zmiany mają docelowe 301. Wykryć pętle, łańcuchy, kolizje, niebezpieczne cele i nierozstrzygnięte adresy. Sprawdzić sitemap, canonical oraz Product, Course i Organization. Mapa jest materiałem do przyszłej migracji, bez zmiany domeny klienta.
5. Przejść panel jako klient: zdjęcie, produkt, kurs, termin i wpis. Poprawić niejasne pola, kwoty i utratę niezapisanych zmian. Zachować dane, schemat i role. Instrukcja Markdown opiera się na sprawdzonych operacjach.
6. Dodać regresję Playwright w CI: dane syntetyczne, tylko loopback, izolowana baza, brak rzeczywistych płatności i poczty. Regresja desktop/mobile na własnej kopii zakończona: 22/22 PASS. Rzeczywisty wynik uruchomienia CI pozostaje do zapisania.
7. Zintegrować oddzielne worktree, sprawdzić typecheck, testy i build. Po review wdrożyć na własny podgląd Coolify i sprawdzić HTTPS, ochronę oraz wersję.
8. Zaktualizować raport, instrukcję, checkpoint i jedną listę decyzji dla Wojtka. Zamknąć własne karty, tunele, kontenery, serwery i procesy. Zachować dowody i wyniki pracy.

Ograniczenia: brak aktualnego zrzutu SQL klienta, wybranego operatora oraz zatwierdzonych danych handlowych i dokumentów nadal wyklucza końcowy odbiór całego projektu. Te braki nie blokują powyższej rundy. Maksymalnie dwa ciężkie buildy jednocześnie.

## Checkpoint przed pushem: V13 i runtime V12, 9.10.2026

Zamrożona kopia V13 zawiera 319 plików; SHA archiwum to `56a2e6a005a9227f65f8284259101d74614c3f4e38790a56b1634a5dee1a3a70`. Typecheck bez incremental zakończył się kodem 0 w 15,024 s; oficjalny runner na Node 22.23.3 potwierdził 351/351 PASS w 41 plikach, kod 0, 234,893 s oraz zero błędów, anulowań i pominięć. Wszystkie 319 hashów i typy Payload pozostały niezmienione. `tsconfig.tsbuildinfo` nie należy do archiwum. Prywatny `native-v13-summary.json` wskazuje pełne logi, tożsamość zależności i cleanup własnego TMPDIR oraz kontenera.

Cztery regresje sprawdziły rzeczywisty formatter publicznych błędów konfliktu magazynu i poprawną korektę operacyjną. Test rezerwacji kursu przeszedł rzeczywiste zgłoszenie i zapis redaktora: stary licznik został odrzucony kodem 403 bez zmiany danych, a zapis samego tytułu zachował zajęte miejsce. Nie przypisujemy symulowanej utraty nazwy błędu konkretnej przyczynie kompilacji.

Runtime V12 ma obraz `sha256:b745cab53ee1c1d7c9752405607d84490b0060b140fc0c1866c5deaff1a58c17`. Manifest `v12-v13-runtime-source-equivalence.json` potwierdza, że V13 różni się tylko typowaniem fixture w jednym teście CMS, bez różnicy w źródłach runtime ani E2E. Końcowy E2E tego obrazu zakończył się naturalnym kodem 0: 22/22 PASS desktop/mobile, bez retry, pominięć i flaky, około 1,7 min. JSON raportu podaje 100,095 s, podsumowanie polecenia około 102 s. `e2e-final-v12-summary.json`, log oraz `test-results/results.json` zachowują tożsamość testów i wynik. To zakończona regresja kopii; faktyczny GitHub Actions pozostaje osobnym etapem.

Końcowy Opus 5.5 high ma `MERGE OK` dla źródeł i wyglądu, bez nowych P1/P2 (`opus-final-v13-delta-result.md`); naturalne zakończenie review zajęło 35,227 s. Wcześniejsze warunkowe P2 dla trzech reguł obrazów jest zamknięte. Dodane `height:auto` zachowało proporcje kart i syntetycznego produktu z dwoma zdjęciami przed oraz po przełączeniu. Review Codexa minimalnej poprawki błędów oraz końcowej różnicy CSS, castu testowego i CI ma `MERGE OK` bez P1/P2. Workflow ustawia `NODE_ENV: production` tylko w kroku `pnpm test`, zgodnie z dowodem native351; faktyczny przebieg Actions nie jest jeszcze potwierdzony.

Negatywne przebiegi pozostają jawne: V12 TC zakończył się kodem 2 przez typowanie fixture, więc pełne testy wtedy nie wystartowały. Wcześniejsze E2E V11 miało dwa błędy selektora, a następne także `ECONNRESET` przed gotowością serwera i nieczytelny komunikat 409. Ich logi nie zostały zastąpione wynikiem V12. V11 native 347 PASS i V9 native 346 PASS są historyczne; liczników nie sumujemy.

| Etap | Stan w tym zapisie | Dowód do zachowania lub uzupełnienia |
|---|---|---|
| TC i pełne native V13 | Zakończone | Naturalne 0, 351/351 PASS, 319 SHA przed/po, logi i cleanup w `native-v13-summary.json` |
| Końcowe E2E runtime V12 | Zakończone | Naturalne 0, 22/22 PASS, oba projekty, bez retry; manifest zgodności runtime V13 i raport Playwright |
| Końcowe pomiary i dostępność V12 | Zakończone w opisanym zakresie | 18 Lighthouse, sześć kontroli funkcjonalnych, 54 widoki oraz axe; dwa LCP powyżej progu i granice laboratoryjne zachowane |
| Końcowy Opus | Zakończony | `MERGE OK` źródeł i wyglądu, brak nowych P1/P2, poprzednie P2 zamknięte |
| Rzeczywisty CI | Oczekuje | Link do uruchomienia, testowany commit i wyniki z artefaktami |
| Commit, wdrożenie i HTTPS | Oczekują | Commit, identyfikator deploya i runtime obrazu, ochrona podglądu oraz zachowanie własnych danych |

Prowadzący uzupełni CI i wdrożenie po ich zakończeniu. To checkpoint przed pushem: późniejszy raport realizacji z rzeczywistym URL CI, commitem i tożsamością deploya ma pierwszeństwo. TC, 351 testów, 22 E2E i pomiary kopii nie zastępują odbioru klienta.

## Końcowe pomiary V12 przed pushem

`performance-after-v12/summary.json` zachowuje naturalnie zakończony pomiar 18/18 Lighthouse mobile i sześciu kontroli funkcjonalnych z 13:07:19–13:10:26 UTC. Każda ścieżka ma trzy oddzielne profile z zimnym cache przeglądarki, rozgrzanym serwerem i banerem prywatności przy pierwszej wizycie. Obraz runtime to b745…; wyników V9 nie przenoszono.

| Ścieżka | LCP mediana / maksimum (s) | CLS maksimum | Kontrolowana próbka INP (ms) |
|---|---:|---:|---:|
| Strona główna | 1,992 / 2,126 | 0,000268 | 64 |
| Kategoria | 1,887 / 3,639 | 0,000249 | 104 |
| Produkt | 1,790 / 2,265 | 0,000271 | 64 |
| Kurs | 1,773 / 2,658 | 0,000158 | 72 |
| Pusty koszyk | 1,071 / 1,652 | 0,000152 | 56 |
| Wypełniony checkout | 1,507 / 1,530 | 0,006041 | 56 |

Wszystkie sześć median LCP spełnia próg 2,5 s; 16/18 pojedynczych prób jest poniżej niego. Dwa przekroczenia, kategoria 3,639 s i kurs 2,658 s, pozostają w dowodzie. Wszystkie próbki CLS są poniżej 0,1. INP 56–104 ms opisuje kontrolowane interakcje, a nie terenowe p75; TBT nie zastępuje INP.

`v12-width-matrix-proof.json` potwierdza 54/54 widoki: sześć ścieżek na szerokościach 320, 360, 390, 430, 768, 1024, 1100, 1440 i 1920 px, bez overflow. Sześć desktopowych axe oraz dwanaście mobilnych kontroli (przed i po zamknięciu banera) nie wykazało naruszeń, pozostawiając jawne przypadki `incomplete`. Klawiaturowy fokus w modalu był widoczny i miał kontrast 5,131:1. Reflow 320×180 px jest kontrolą zmniejszonego viewportu, bez twierdzenia o literalnym ustawieniu zoom przeglądarki. Wyniki nie certyfikują całego WCAG 2.2 AA ani terenowego CWV.

## Historyczny checkpoint i pomiary V9

Zamrożona kopia V9 zawiera 320 plików; SHA archiwum to `ed4a7cc3cf1511ca87a91df90d7048abac4e60a7ff2cfffdd925652485a46a80`. Zbudowany obraz kandydata ma ID `sha256:f9f9e58be7d5d0eecfbc3d3044cea40dc5944ab9076b28eec9ae32745085768f`. Typecheck bez incremental zakończył się kodem 0 w 17,528 s, a oficjalny runner na Node 22.23.3 potwierdził 346/346 PASS w 41 plikach, kod 0, 227,242 s i zero pominięć. Wszystkie wejściowe hashe oraz typy Payload pozostały niezmienione. Prywatny `native-v9-summary.json` oddziela ten wynik od wcześniejszych przebiegów i wskazuje pełne logi.

Pomiar V9 z 12:15:15–12:18:26 UTC wykonał 18/18 zimnych prób Lighthouse mobile, po trzy na ścieżkę. Użył syntetycznej oferty na osobnej kopii, tego samego obrazu V9, pierwszej wizyty z banerem prywatności i pustego cache przeglądarki; serwer był rozgrzany. `performance-after-v9/summary.json` oraz `performance-after-v9-freeze.json` zachowują wyniki i tożsamość źródeł. Poniższe wartości nadal dotyczą V9; do czasu nowego dowodu nie przypisujemy ich runtime V12/V13.

| Ścieżka | LCP mediana / maksimum (s) | CLS mediana / maksimum |
|---|---:|---:|
| Strona główna | 2,245 / 4,359 | 0,000152 / 0,000152 |
| Kategoria | 1,473 / 1,893 | 0,000249 / 0,000255 |
| Produkt | 2,370 / 2,678 | 0,000152 / 0,000152 |
| Kurs | 2,275 / 2,709 | 0,000152 / 0,000152 |
| Pusty koszyk | 1,075 / 1,523 | 0,000152 / 0,000152 |
| Wypełniony checkout | 0,861 / 1,073 | 0,002943 / 0,002943 |

Wszystkie mediany LCP mieszczą się poniżej 2,5 s, lecz trzy pojedyncze próby przekraczają ten próg. Wszystkie próbki CLS mieszczą się poniżej 0,1. Kontrolowane interakcje dały próbki INP 48–152 ms; axe nie zgłosił naruszeń na sześciu ścieżkach przed i po zamknięciu banera, ale pozostawił przypadki wymagające ręcznej oceny. Reflow 320 px nie wykazał overflow. Wynik opisuje warunki laboratoryjne; terenowe p75 i pełna zgodność WCAG 2.2 AA wymagają odrębnych dowodów.

Mapa `migration-map-final-v2` ma 6126 URL-i: 5256 retained200, 625 redirect301, 180 unresolved404 i 65 review; osobny audyt obejmuje 627 przekierowań, a XML 5227 adresów kanonicznych. Kontrola potwierdziła zgodność ośmiu SHA wejść i wyników. Eksport działał offline, bez żądań do klienta lub zapisów bazy; dodatkowa propozycja 301 pozostaje niewdrożona.

Historyczny wynik V9 pozostaje osobnym dowodem, a aktualne otwarte etapy opisuje tabela V13/runtime V12 powyżej. Trzy przekroczenia LCP dotyczą wyłącznie tego historycznego V9; aktualny V12 ma dwa i opisuje je powyżej. Granice laboratoryjnego INP, przypadki axe do ręcznej oceny i brak dowodu terenowego p75/WCAG AA nadal pozostają jawne.
