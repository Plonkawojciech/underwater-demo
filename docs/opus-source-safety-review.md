Przeczytałem (tylko do odczytu) `content_parser.py`, `public_bundle.py`, `public_capture.py`, `snapshot_worker.py`, oba pliki testów oraz potrzebne fragmenty `bundle.ts`, `ftp_readonly.py` i `inventory.py`. Niczego nie uruchamiałem, więc wszystkie wyzwalacze poniżej wynikają z czytania kodu, nie z testów. Znalazłem jeden poważny problem, dwa średnie i kilka mniejszych.

## Poważny

**1. Blokada nawigacji kalendarza nie obejmuje wszystkich widoków JEvents — `public_capture.py:37`, `:74`, `:113`**
- Lista blokowanych ścieżek ma widok dnia, miesiąca i roku. Brakuje widoku tygodnia (`week.listevents`), kategorii (`cat.listevents`) i zakresu (`range.listevents`). Prawdopodobnie brakuje też przyjaznych adresów `eventsbyweek`, `monthcalendar` i `eventsbycategory` — nazwy podaję z pamięci routera JEvents; fixture potwierdza tylko styl `eventsbyday` i `eventdetail`. Adresy spoza `/kalendarz/`, np. `/component/jevents/...`, nie są blokowane wcale.
- Wyzwalacz: dowolna strona linkuje `/kalendarz/week.listevents/2026/10/12/-.html`. `allowed()` przepuszcza adres, a link „następny tydzień” prowadzi w nieskończoność.
- `capture_priority` daje adresom `kalendarz…` priorytet 0, więc ten nieskończony graf jest pobierany przed sklepem.
- Po przekroczeniu 20 000 adresów linia 113 rzuca wyjątek przed zapisem stanu w linii 116. Ostatnia pobrana strona nie trafia do manifestu, a każdy kolejny resume od razu znowu trafia na limit. Przechwytywanie publicznych stron nigdy się nie skończy.

## Średnie

**2. Ten sam termin kursu trafia do kalendarza dwa razy — `content_parser.py:1426-1432`**
- Data z kursu ma format `…T16:30:00.000Z` (linia 1048), a data z kalendarza `…T16:30:00Z` (linia 1118). Porównanie `==` nigdy nie wychodzi prawdziwe.
- Dodatkowo `href` linku w kalendarzu prowadzi do `/kalendarz/eventdetail/…`, a nie na stronę kursu, więc kurs i tak nie zostanie dopasowany.
- Wyzwalacz: strona kursu zawiera „Najbliższy kurs rozpoczyna się: 2026-10-12 o godz. 18:30”, a `/kalendarz.html` ma w komórce dnia 12 wpis „18:30 Kurs X”. Powstają dwa opublikowane wydarzenia o tej samej godzinie. Gałąź deduplikacji jest w praktyce martwa, a test w linii 784 tego przypadku nie sprawdza.

**3. `complete_snapshot` może zgłosić pełną kopię, choć pliki pominięto — `snapshot_worker.py:492-495`**
- `inventory.py:83` i `:85` przenoszą pliki `.env*`, historię powłoki i symlinki do `skipped` jeszcze przed workerem. Worker sprawdza tylko powód `inaccessible-directory` i własną listę `self.excluded`, która w realnym przebiegu jest pusta.
- Skutek: `complete_snapshot: true`, mimo że symlinki (np. `public_html/images -> …`) i pliki `.env` nie zostały skopiowane.
- Test w linii 426 podaje `.env` bezpośrednio w `files`, czyli inaczej niż robi to prawdziwy inwentarz, więc tego nie wychwytuje.

**4. Kolejność obrazów i zdjęcie główne wynikają z alfabetu, nie ze strony — `public_bundle.py:80`, `:129-136`, `:141-148`**
- Pętla idzie po `converted['media_urls']`, które są posortowane po ścieżce (`content_parser.py:1507`). Tak powstają `relations.images`, `photos` w albumie i „pierwsze” zdjęcie (`image`).
- Wyzwalacz: główne zdjęcie produktu `…/product/maska_z.jpg` i dodatkowe `maska_a.jpg` dają `images[0]` = dodatkowe. Aplikacja używa `images[0]` jako zdjęcia głównego (`ProductCard.tsx:5`, `AddToCart.tsx:40`, `meta.ts:58`).
- W albumie kolejność wychodzi `zdjecie-1, zdjecie-10, zdjecie-2`. Zdjęcie główne kursu lub strony to obraz pierwszy alfabetycznie, nie pierwszy w treści.

**5. Podpis zdjęcia bywa pożyczony z innego miejsca — `public_bundle.py:136`**
- `ref.get('caption', row['alt'])`: gdy dany cel nie ma podpisu, wstawiany jest alt pliku, czyli pierwszy niepusty alt z dowolnego innego miejsca, w którym ten plik występuje.
- Wyzwalacz: ten sam plik jest w albumie A z `title="Rafa"` i w albumie B bez podpisu — B dostaje „Rafa”. Tak samo podpis pominięty jako za długi (`content_parser.py:1269-1271`) zostaje zastąpiony obcym tekstem.
- Poprawka: `ref.get('caption', '')`.

## Niskie

6. **`public_bundle.py:88-90`** — przy ponownym użyciu pliku brany jest stary opis (`previous`), więc zmieniony alt czy URL z nowej konwersji przepada. Kopia szyfrowana jest nadpisywana (`:109-110`) przed sprawdzeniem symlinka i zapisem pliku. Jeśli ten krok się nie powiedzie, archiwum będzie miało nowsze bajty niż hash w manifeście.

7. **`snapshot_worker.py:237`, `:262-263`, `:179`** — po pierwszym udanym logowaniu każda odpowiedź 530 przy otwieraniu 2.–4. połączenia jest traktowana jak błąd hasła i zatrzymuje cały przebieg, zamiast wyłączyć tylko to jedno połączenie (`Retire`). ProFTPD przy limicie połączeń na użytkownika odpowiada 530. Tryb 4 połączeń może więc kończyć się `error_perm`, choć hasło jest poprawne. Nie wiem, jaki serwer działa na e-kei.

8. **`content_parser.py:1334`** — `reason` przekierowania ma zakodowany tekst „Ten sam produkt VirtueMart (ID None)”. Po dodaniu katalogu specjalizacji PADI ten sam slug pod `kursy-nurkowania/` i `kursy-specjalizacji-nurkowych-padi/` scala się w przekierowanie kursu z takim opisem.

9. **`public_bundle.py:57`** — dekodowanie jest ścisłe: jedna strona z błędnym charsetem w nagłówku (np. iso-8859-2 bez nagłówka) przerywa konwersję wszystkich stron. Mechanizm jest bezpieczny, ale zatrzymuje całość.

10. **`content_parser.py:1301`** — przy kilku kopiach tego samego adresu pole `seo` jest pominięte w porównaniu treści, więc tytuł i opis SEO pochodzą z przypadkowej kopii. Licznik `pagesConverted` liczy kopie, a nie adresy.

## Co sprawdziłem i wygląda poprawnie

- **Strefa czasowa Warszawy:** godzina dwuznaczna i nieistniejąca przy zmianie czasu jest odrzucana w obu ścieżkach (1046, 1113-1117).
- **Flagi kompletności:** `source.complete` jest zawsze `False`, `databaseSnapshot`/`database_snapshot` zawsze `False`.
- **FTP tylko do odczytu:** jest lista dozwolonych komend, a `storbinary`/`storlines` są zablokowane.
- **Wznawianie:** stary szyfrogram jest uwierzytelniany i hashowany przed wznowieniem; obiekty nigdy nie są kasowane, tylko przemianowywane; worker usuwa wyłącznie własne pliki `.part`.
- **Wykrywanie artykułu w `right-sitebar`:** przy kilku `.article-content` kończy się `ambiguous`.
- **Kilka kopii jednego adresu:** różna cena lub treść nadal daje `conflicting-source-content`.

## Czego nie weryfikowałem

- Dokładnych przyjaznych adresów JEvents na żywej stronie (punkt 1).
- Czy dni wydarzeń wielodniowych w siatce miesiąca JEvents pokazują godzinę. Jeśli tak, każdy dzień takiego wydarzenia stałby się osobnym wydarzeniem z wymyśloną datą — tego nie ma w fixture'ach.
- Kodu importera poza kontraktem `bundle.ts`.
