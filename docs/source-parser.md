# Konwerter publicznych stron Underwater

`scripts/source/content_parser.py` zamienia odszyfrowane publiczne strony obecnej witryny (Joomla + VirtueMart) w bundle importu v1 (`src/lib/import/bundle.ts`). Działa wyłącznie na bibliotece standardowej Pythona i jest czystą funkcją: nie łączy się z siecią, nie odszyfrowuje archiwów i nie czyta źródła. Odszyfrowanie i pobranie mediów należą do koordynatora.

Publiczny crawl nie jest zrzutem bazy. Bundle zawsze ma `source.kind = 'public-pages'` i `source.complete = false`, więc import kończy się statusem `needs-review`. Wynik konwersji nie potwierdza kompletności ani zgodności ze źródłem.

## Wejście i wyjście

```python
convert_pages(pages, captured_at, manifest_hash) -> {bundle, media_urls, unresolved, counts}
```

- `pages`: lista `{url, html, sha256, charset?}`. `html` to tekst strony, `sha256` to skrót oryginalnych bajtów. Strona, której `html.encode(charset)` nie daje tego skrótu, zostaje pominięta (`integrity-mismatch`).
- `captured_at`: znacznik ISO 8601. `manifest_hash`: 64 znaki hex (małe litery).
- `bundle.media` jest puste. `media_urls` to osobna lista `{key, path, url, alt, targets, alternateUrls?}`. `path` to zdekodowana ścieżka obrazu bez początkowego `/` w postaci Unicode NFC, tak jak importer rozwiązuje każdy adres obrazu; od niej zależy `key`. `url` to adres HTTPS do pobrania w formie, którą podała strona (pierwsze wystąpienie w kolejności encji). Gdy ten sam plik pojawia się też w innej formie Unicode (NFD), pozostałe adresy są w `alternateUrls`.
- `unresolved`: posortowana lista `{code, url, key, detail}` do przeglądu.
- `counts.skipped` liczy także pominięcia bez wpisu w `unresolved` (`home-landing`, `category-listing`, `duplicate-page-capture`, `same-route-alias`).
- `counts`: liczba stron, pominięcia według powodu, encje według kolekcji.

CLI czyta lokalny JSON i zapisuje lokalny JSON z uprawnieniami `0600`. Nie nadpisuje pliku bez `--force` i odrzuca ścieżki `.env*`. Na stdout trafiają tylko liczniki.

```sh
python3 scripts/source/content_parser.py pages.json result.json --captured-at 2026-10-08T12:00:00Z --manifest-hash <sha256>
```

`pages.json` może być samą listą stron albo obiektem `{pages, capturedAt, manifestHash}`.

## Rozpoznawanie stron

| Strona | Rozpoznanie | Wynik |
| --- | --- | --- |
| `/`, `/index.php` | ścieżka | pominięta (`home-landing`), kafelki `h1` nie są treścią |
| produkt | `.ProductContainer` | `products` |
| listing sklepu | `/sklep-nurkowy[...]` albo adres kategorii od korzenia (`/80-maski-i-fajki.html`) potwierdzony nawigacją sklepu, bez `.ProductContainer` | tylko dane kategorii |
| sekcja aplikacji | ścieżka z `FIXED` w `src/views/resolve.ts` (niżej) | `pages`, raport informacyjny `source-section-content` |
| przegląd kursów | `/kursy-nurkowania/kursy-nurkowania-<…>.html` | `pages`, raport informacyjny `course-landing-page` |
| kurs | `/kursy-nurkowania/<slug>.html` lub zweryfikowany katalog `/kursy-specjalizacji-nurkowych-padi/<slug>.html` | `courses` |
| wyjazd | `/wyprawy-nurkowe/<slug>.html` | `trips` |
| album | `/galeri*` z rzeczywistymi zdjęciami galerii (poza ścieżką sekcji) | `albums` |
| folder galerii | `#phocagallery.pg-category-view`, `.pg-box-subfolder` i jeden jawny `h1` | `pages` z odnośnikami do dzieci i miniaturami; folder mieszany zachowuje też zdjęcia w body |
| pozostałe | treść artykułu w kolumnie środkowej (niżej) | `pages` z `kind` według ścieżki |

Treść artykułu ma trzy rozpoznawane układy. Na stronie może być tylko jeden artykuł; widok bloga lub listy (kilka bloków) daje raport `ambiguous-main-content`, bo strona nie mówi, który wpis odpowiada adresowi.

1. Joomla 3: `.item-page`. Tytuł to `h1` spoza `[itemprop=articleBody]`, a bez niego `[itemprop=headline]`, `h2` w `.page-header` lub `h2.contentheading`. Treść to `[itemprop=articleBody]`, a bez niego cały blok bez tytułu.
2. Starsza Joomla, czyli układ obecnej witryny: `div.article-content` w `.portal-real-content`, `.portal-center-site-bar` lub `.center-sitebar`. Na stronach kursów kolumną główną jest `div.fr.right-sitebar` w `.portal-real-content` (niżej). Tytuł to najbliższy wcześniejszy `.contentheading` na poziomie bloku albo jego przodka, nie dalej niż kolumna treści (`<h2 class="contentheading">…</h2><div class="article-content">…</div>`). `h1` w treści jest tam ramką kontaktową i nigdy nie zastępuje tytułu; dla zweryfikowanego układu aktualności tytułem może też być jedyny `.nsp_header` w pojedynczym artykule. Brak rozpoznanego tytułu daje `missing-title`.
3. Jedyny `article` w kolumnie treści, tytuł jak w punkcie 1.

Panele boczne są rozpoznawane po nazwach klas i id zawierających `sidebar`/`sitebar`/`site-bar` (`sidebar-right`, `left-sitebar`, `right-sitebar`, `portal-left-site-bar`), chyba że nazwa zawiera `center`/`centre` (`center-sitebar`, `portal-center-site-bar` to kolumna treści).

Wyjątek wynika z szablonu witryny, który kolumnę główną strony kursu też nazywa stroną (`div.fr.right-sitebar`). Taki `div` jest treścią przy zweryfikowanym bloku artykułu: z wcześniejszym `.contentheading` albo jednym `.nsp_header` w jedynym artykule (okruszki w `.portal-breadcrumb` mogą być przed nimi). Wyjątek nie dotyczy `aside`, `nav`, `footer`, modułów (`moduletable*`, `module`, `menu` itd.), id typu `menu*`/`left`/`right` ani paneli, w których tytuł i artykuł leżą głębiej (np. w `div.custom` modułu). Kilka `.article-content` w takiej kolumnie to nadal lista: raport `ambiguous-main-content`.

Z treści usuwane są skrypty, style, formularze, iframe, embedy, nawigacja, panele boczne, moduły, stopka, informacje o artykule (`article-info`, `article-tools`, `createdate` itd.) i paginacja. `h1` wewnątrz treści staje się `h2`, bo tytułem strony jest `h1` aplikacji. Miniatura w linku do własnego pełnego pliku (`<a href="duży.jpg"><img src="mały.jpg"></a>`) jest zastępowana tym pełnym plikiem bez linku.

Linki w treści:

- zostają: linki do stron witryny (bez query, bez rozszerzenia albo z `.html`/`.htm`), z fragmentem `#…`; linki zewnętrzne `http(s)`; `mailto:` i `tel:`; kotwice `#…`. Względne adresy są rozwiązywane względem `<base href>` lub adresu strony. `/index.php` i `/index.html` bez query stają się `/`.
- znikają, a ich tekst zostaje, z raportem `internal-link-unresolvable`: linki do własnej witryny z query (`/index.php?option=com_virtuemart&view=cart`, `option=com_content&id=…`, `com_mailto`, `?task=checkout`) i bezpośrednie linki do plików, których import nie obejmuje (`.pdf`, `.php`, obraz poza miniaturą typu lightbox). Raport podaje adres bez query, same nazwy parametrów, wartość `option` (tylko postać `com_…`) i tekst linku. Wartości parametrów (ID, tokeny, zakodowane adresy) nie trafiają ani do treści, ani do raportu. Konwerter nie zgaduje artykułu ani celu przekierowania.
- znikają bez raportu, z zachowaniem tekstu: `javascript:` i inne schematy, adresy z danymi logowania, `<a>` bez `href`.

`kind` wynika z trasy: `legal` (regulamin, polityka, dostawa, płatności, zwroty itd.), `news` (`/aktualnosci/...`), `report` (`/relacje.../...`), w pozostałych przypadkach `page`.

Ścieżki sekcji: `/sklep-nurkowy`, `/kursy-nurkowania`, `/kursy-nurkowania/kursy-nurkowania-padi-warszawa.html`, `/kontakt`, `/wyprawy`, `/wyprawy-nurkowe.html`, `/kalendarz`, `/aktualnosci`, `/relacje`, `/relacje-z-wypraw.html`, `/galerie`, `/galeria.html`. Aplikacja renderuje je sama i bierze z rekordu `pages` o tym `legacyPath` tytuł, SEO i treść wstępu. Dlatego strona źródłowa pod taką ścieżką jest zawsze `pages` (nie kursem, wyjazdem ani albumem), a raport `source-section-content` jest informacyjny. Sekcja bez treści artykułu (np. `/kontakt.html` z samym formularzem aiContactSafe) nie dostaje rekordu i ma raport `no-main-content`. `/sklep-nurkowy.html` jest listingiem i daje tylko dane kategorii.

## Kursy

- `name` z tytułu artykułu, `slug` z adresu, `org` tylko z jednoznacznej nazwy organizacji w tytule; w pozostałych przypadkach `null`. Cała treść zostaje w `body`.
- `nextDate` powstaje tylko z dokładnie jednego zdania `Najbliższy kurs rozpoczyna się: RRRR-MM-DD o godz. GG:MM` w treści. Czas jest czasem lokalnym Warszawy (`zoneinfo`, `Europe/Warsaw`) przeliczonym na UTC, np. `2026-10-12 o godz. 18:30` → `2026-10-12T16:30:00.000Z`. Nieistniejąca data lub godzina, godzina z luki albo powtórzenia przy zmianie czasu, inny zapis i więcej niż jedna wzmianka dają raport `course-date-not-imported` bez `nextDate`. Zdanie zostaje w `body` w każdym przypadku.
- Jawny `nextDate` daje `course-sessions` z tą samą godziną. Limity, ceny, koniec terminu i miejsce pozostają nieznane. Nie powstają wymagania ani uprawnienia na podstawie domysłu.
- `/kalendarz.html`: daty wyłącznie z linków `cal_daylink`, godziny i nazwy z `cal_titlelink`. Zweryfikowana siatka `jevblocksN` wskazuje dzień początku; wydarzenie wielodniowe daje jeden początek bez wymyślonego końca. Miesiąc jawnie odczytany z kalendarza zastępuje kalendarzowe wpisy wyprowadzone ze zdań kursowych; terminy zgłoszeń pozostają. Inne widoki kalendarza nie są bez ograniczeń crawlowane.

## Produkty

- ID VirtueMart: `id="productPrice<ID>"` lub `input[name=virtuemart_product_id[]]` w kontenerze produktu, z pominięciem bloków produktów powiązanych. Numer w adresie nie jest ID (adres `1115-...` może należeć do produktu 1482). Brak ID albo dwa różne ID oznaczają raport i pominięcie.
- Cena: `span.PricesalesPrice` w bloku ceny tego ID, zapis polski (`1 299,00 zł` → `129900`). Brak ceny, zapis niejednoznaczny albo różne ceny oznaczają raport i pominięcie. Jawne `0,00 zł` to znana wartość źródłowa: `priceCents: 0`, `stock: null`, a aplikacja pokazuje taki produkt jako cenę na zapytanie (bez koszyka i `Offer`). Bundle zawiera tylko `priceCents`; importer wylicza z niego `price`.
- Kategoria: ostatnia kategoria w ścieżce `.breadcrumbs` (sekcja Kategorie), a gdy jej brak, kategoria nadrzędna w zagnieżdżonym adresie, o ile ta kategoria została zaobserwowana. Produkt bez rozwiązanej kategorii nie trafia do bundla.
- `slug` to pełna zdekodowana ścieżka bez `/` i `.html`. `legacyPath` zachowuje polskie znaki i `.html`. Slug musi spełniać regułę importera (sekcja Limity importera); w przeciwnym razie produkt jest pomijany z raportem `invalid-slug`, a pozostałe strony konwertują się normalnie.
- `stock: null` dla produktu i wariantów. Napis „dostępny” nie jest stanem magazynowym. Konwerter nie ustawia VAT, ceny promocyjnej, SKU ani specyfikacji.
- Warianty powstają tylko z jednego widocznego pola opcji (`select` lub grupa `radio` w `.product-fields`): `label` to tekst opcji, `legacyKey` to stabilny SHA-256 pary nazwa pola + NUL + wartość, z prefiksem `public-option:`. Dopłaty w etykietach nie są przeliczane (`variant-price-text-not-imported`). Przy dwóch lub więcej polach kombinacje nie są znane, więc wariantów nie ma, opis zostaje, a raport ma kod `ambiguous-variants`.
- Zdjęcia: `.main-image`, `.additional-images`, `img.product-image`. Gdy miniatura prowadzi do pliku obrazu, wybierany jest ten pełny plik; bez takiego linku zostaje miniatura (`resized/...`). Jeżeli w tych blokach nie ma zdjęć, a w kontenerze (poza opisem i produktami powiązanymi) są obrazy z katalogu zdjęć VirtueMart, raport `product-images-outside-holder` podaje ich liczbę; nie są przypisywane, bo mogą należeć do innego produktu.

## Kategorie

Kategorie pochodzą z linków w `.breadcrumbs` i z menu VirtueMart (`li.VmOpen`/`li.VmClose`). Rozpoznawane są dwie formy adresu:

- `/sklep-nurkowy/<ID-slug>[/<ID-slug>...]`, w każdym miejscu okruszków i menu;
- forma od korzenia, której używa obecny sklep: `/<ID-slug>[/<ID-slug>...]`, np. `/80-maski-i-fajki.html` i `/80-maski-i-fajki/139-maski-nurkowe.html`. Ten sam kształt mają adresy produktów (`/3625-maska-soprastek-corona.html`), więc taki link jest kategorią tylko w menu VirtueMart albo w okruszkach po linku do samego sklepu (`/sklep-nurkowy.html`). Okruszki strony spoza sklepu (`Strona główna › /45-blog.html`) nie tworzą kategorii. Strona listingu w tej formie jest rozpoznawana tylko wtedy, gdy nawigacja na którejkolwiek przechwyconej stronie wskazuje ją jako kategorię; w przeciwnym razie jest zwykłą stroną treści. Adres przechwyconej strony produktu nigdy nie zostaje kategorią (raport `category-link-is-product-page`).

Okruszki strony produktu nie tworzą kategorii z linku do samego produktu. Pomijany jest link, którego adres (porównywany kluczem trasy, niżej) jest adresem strony albo jej `rel=canonical`, oraz link z tekstem równym `h1` produktu z `.ProductContainer`. Dzieje się tak niezależnie od tego, czy krótki adres produktu został przechwycony. Numer w adresie niczego tu nie przesądza: konwerter nie uznaje adresu za produkt ani za kategorię na podstawie samego kształtu `/<liczba>-<nazwa>.html`.

`slug` to zdekodowana ścieżka bez `/` i `.html` (`80-maski-i-fajki/139-maski-nurkowe`), `legacyPath` to adres z linku (`/80-maski-i-fajki/139-maski-nurkowe.html`). `/sklep-nurkowy.html` jest sklepem, a nie kategorią nadrzędną. Rodzica wyznacza kolejność okruszków i zagnieżdżenie menu. Sprzeczni rodzice, nazwy lub cykle trafiają do raportu (przy sprzecznym rodzicu kategoria zostaje bez rodzica). `vmId` jest ustawiane tylko z jawnego `input[name=virtuemart_category_id]` na stronie listingu, nigdy z numeru w adresie.

## Duplikaty i konflikty

Adresy porównywane są tym samym kluczem trasy co w importerze (`routeKey` w `bundle.ts`): ścieżka NFC bez początkowych i końcowych `/` i bez końcowego `.html` w dowolnej wielkości liter. `/x`, `/x/`, `/x.html` i `/x.HTML` to jeden adres.

- Ten sam URL z identycznym skrótem liczy się raz; z różnymi skrótami jest pomijany w całości.
- Ten sam produkt pod kilkoma adresami: przy identycznej treści powstaje jeden rekord (adres z `rel=canonical`, w przeciwnym razie najkrótszy) i jedno przekierowanie na każdy inny klucz trasy (z formy `.html`, gdy jest). Adres o tym samym kluczu co rekord (`/x` obok `/x.html`) nie dostaje przekierowania, bo importer uznałby je za wskazujące na siebie; liczy się jako `same-route-alias`. Przy różnej treści pomijane są wszystkie warianty, a raport ma kod `conflicting-source-content`.
- Każdy klucz trasy może należeć do jednej encji. Trasy encji liczone są jak w importerze: `legacyPath`, `path` stron, wyjazdów i albumów, `from` przekierowania, `slug` produktu i kategorii, `kursy-nurkowania/<slug>` kursu. Również `slug`, `vmId`, `path` i `from` są unikalne w obrębie kolekcji. Konflikt (np. różne strony pod `/x` i `/x.html`, strona pod adresem przekierowania) usuwa wszystkie encje, które zgłaszają ten adres lub wartość, a następnie encje od nich zależne (np. produkty usuniętej kategorii, przekierowania do usuniętego produktu). Raport: `conflicting-source-path` (szczegół: `address '<klucz>': <ścieżki>`) albo `conflicting-source-value`. Reszta bundla przechodzi walidację importera.

## Limity importera

Konwerter sprawdza wartości tak jak `fieldSpecs` w `bundle.ts`, z długością liczoną jak w JavaScripcie (jednostki UTF-16). Treść klienta nigdy nie jest skracana.

| Pole | Limit | Przy przekroczeniu |
| --- | --- | --- |
| `name` kategorii, produktu, kursu | 300, bez znaków sterujących C0/C1 | rekord pominięty, `field-invalid` |
| `title` strony, wyjazdu, albumu | 500, bez znaków sterujących | rekord pominięty, `field-invalid` |
| `short` produktu | 5000 | rekord pominięty, `field-invalid` |
| `body` (HTML) | 1 000 000 znaków | rekord pominięty, `field-invalid` |
| `label` wariantu, liczba wariantów | 300, 500 | produkt pominięty, `field-invalid` |
| zdjęcia produktu (`images`), zdjęcia albumu (`photos`) | 500, 2000 | rekord pominięty, `field-invalid` |
| `slug` produktu, kategorii, kursu | segmenty `[\p{L}\p{M}\p{N}_~-][\p{L}\p{M}\p{N}_.~-]*`, łącznie 200, NFC, bez znaków niewidocznych (`Cf`); slug kursu bez `/` | rekord pominięty, `invalid-slug` |
| `seo.title`, `seo.description` | 300, 2000 | pole pominięte, `field-omitted`, rekord zostaje |
| podpis zdjęcia albumu | 1000 | podpis pominięty, `field-omitted` |
| `alt` obrazu w `media_urls` | 1000 | `alt` pusty, `field-omitted`; `alt` w HTML treści zostaje |

Reguła slugów odrzuca m.in. `, ( ) + ! & = ; : @ $ * '`. Te znaki są dozwolone w `legacyPath`, więc strona treści pod takim adresem (`/o-nas,firma(1).html`) importuje się normalnie; pomijany jest tylko produkt, kategoria lub kurs, którego slug pochodzi z takiego adresu. Kategoria pominięta z tego powodu pociąga za sobą produkty, które nie mają innej rozwiązanej kategorii (`product-category-unresolved`).

Ścieżka strony jest odrzucana (`out-of-scope-url`), jeśli zawiera po zdekodowaniu znak sterujący C0/C1, znak niewidoczny Unicode (`Cf`, np. U+200B), białe znaki, `%`, `?`, `#`, `\`, segment `.` lub `..`, pusty segment w środku albo zakodowany separator (`%2F`, `%5C`, `%00`, `%3F`, `%23`).

## Media

Przyjmowane są tylko obrazy `jpg/jpeg/png/webp/gif/avif` z `underwater.pl` i `www.underwater.pl`. HTTP z tego hosta jest podnoszone do HTTPS. Odrzucane są: inne hosty, query, dane logowania w URL, `..`, zakodowane separatory (`%2E`, `%2F`, `%5C`, `%00`, `%3F`, `%23`), `%` po zdekodowaniu, znaki sterujące C0/C1 i niewidoczne (`Cf`), ścieżki dłuższe niż 1024 znaki, ukryte segmenty (`.env`, `.git`), zasoby szablonu i komponentów (`templates/`, `media/`, `components/` itd.), piksele 1×1 i obrazy spoza treści (sidebar, moduły, produkty powiązane). Odrzucony obraz znika z body i trafia do raportu bez query i danych logowania.

Tożsamość obrazu to ścieżka NFC. `szczegół.jpg` zapisane znakami złożonymi (NFC) i rozłożonymi (NFD) to jeden wpis `media_urls` z jednym kluczem, a obie formy adresu są w `url` i `alternateUrls`. Wcześniej `path` był dokładną formą ze strony; dla ścieżek ASCII i NFC wynik się nie zmienia.

Wyjątek od `components/`: zdjęcia katalogu VirtueMart w dokładnie tych katalogach (z rozróżnieniem wielkości liter, wraz z podkatalogiem `resized/`):

- `components/com_virtuemart_images/shop_image/product/` — katalog, z którego obecny sklep serwuje zdjęcia produktów;
- `components/com_virtuemart/shop_image/product/` — standardowy katalog VirtueMart 1.1, dopuszczony bez obserwacji na żywej stronie.

Pozostałe ograniczenia (rozszerzenie obrazu, host, port, query, `..`, zakodowane separatory, ukryte segmenty) obowiązują także tam. `shop_image/category/`, ikony motywu VirtueMart i inne pliki komponentów są nadal odrzucane. Konwerter tylko wskazuje adres do pobrania; nie kopiuje ani nie uruchamia plików PHP źródła.

## Integracja (koordynator)

1. Odszyfruj stronę lokalnie i przekaż `{url, html, sha256, charset}`, gdzie `html = bytes.decode(charset)` bez `errors='replace'`.
2. Uruchom konwerter. Przejrzyj `unresolved`.
3. Pobierz każdy `media_urls[].url` do `<mediaRoot>/<path>` i policz sha256 pliku. Gdy `url` nie odpowiada, a wpis ma `alternateUrls`, spróbuj ich po kolei.
4. Dopisz `bundle.media`: `{key, path, sha256, alt}`.
5. `targets[].order` wskazuje kolejność w danej encji. Pobieranie alfabetyczne nie zmienia kolejności zdjęć. Podpis albumu pochodzi tylko z jego celu; pusty pozostaje pusty. Dla `targets` z polem `images` (produkty) dopisz `relations.images = ['media:<key>', ...]`. Albumy zapisuj w `data.photos = [{image: 'media:<key>', caption}]`. Treść HTML rozwiązuje obrazy przez `bundle.mediaUrls` i `bundle.media[].url`; dodaj wszystkie aliasy źródłowe (`url` i `alternateUrls` z tym samym kluczem).
6. `pnpm exec tsx scripts/import/import-bundle.ts result-bundle.json <mediaRoot> --dry-run`, a potem import do izolowanej bazy.

## Ograniczenia

- Fixtures są syntetyczne. `course-legacy.html`, `contact-legacy.html`, `course-right-column.html` i `product-root-category.html` odwzorowują układ rzeczywistych publicznych stron opisany przez koordynatora (sekcja niżej), ale treść, ceny i nazwy plików są wymyślone. Ten moduł nie uruchamiał konwertera na rzeczywistych stronach ani nie porównywał wyniku z bazą źródłową.
- Znaczniki menu bocznego w `course-right-column.html` i bloków zdjęć w `product-root-category.html` (`.main-image`, `.additional-images`) nie pochodzą z żywej strony. Jeśli prawdziwa karta produktu trzyma zdjęcia w innych blokach, produkt zostanie bez zdjęć z raportem `product-images-outside-holder`.
- Link w okruszkach do krótkiego adresu produktu jest pomijany, gdy ten adres jest `rel=canonical` strony albo tekst linku równa się `h1` produktu (sekcja Kategorie). Jeśli strona nie ma ani jednego, ani drugiego, a link prowadzi do nieprzechwyconego adresu w kształcie kategorii, nadal zostanie kategorią; strażnik `category-link-is-product-page` działa tylko dla przechwyconych stron produktów. Odwrotnie: kategoria o nazwie identycznej z `h1` produktu nie zostanie wzięta z okruszków tej strony (może nadal pochodzić z menu VirtueMart albo z okruszków innej strony).
- Linki wewnętrzne do stron, które nie zostały przechwycone, zostają linkami bez sprawdzenia, czy adres będzie istniał w nowej aplikacji.
- Daty publikacji, ceny i wymagania kursów, dane wyjazdów, producent i ceny promocyjne nie są wyciągane. Zostają jako tekst w body. Wyjątek: `nextDate` kursu z jednego jednoznacznego zdania (sekcja Kursy).
- Przegląd kursów spoza wzorca `kursy-nurkowania-<…>` (np. `/kursy-nurkowania/oferta.html`) zostanie zaimportowany jako kurs. Takie przypadki trzeba ocenić ręcznie.
- Listy blogowe (kilka `.article-content`/`article`) są pomijane z raportem `ambiguous-main-content`, a paginacja sklepu i strony komponentów bez rozpoznanego artykułu z raportem `no-main-content`. Wpisy z listy trafiają do bundla tylko z własnych stron.
- Adresy zawierające `%`, białe znaki, `?`, `#`, znaki sterujące lub niewidoczne po zdekodowaniu nie mogą być `legacyPath` i są pomijane (`out-of-scope-url`).
- Kontrola pól HTML ogranicza się do rozmiaru, tak jak w importerze; czyszczenie HTML należy do importera i hooków treści.
- E-maile zakodowane przez Joomlę skryptem znikają razem ze skryptem i zostaje tylko tekst zastępczy.
- Parser HTML jest uproszczony (domykanie `p`, `li`, `td`, `option`; limit głębokości 400). Bardzo zepsuty HTML może przesunąć granice bloków.

## Ustalenia z rzeczywistego DOM (2026-10-08)

Koordynator uruchomił `convert_pages` na 15 zweryfikowanych publicznych stronach: 1 import, 11 × `no-main-content`, maska z `product-category-unresolved`. Na żywym DOM ustalił:

1. Kurs `/kursy-nurkowania/padi-open-water-diver.html`: kolumna główna to `div.fr.right-sitebar` w `.portal-real-content` (przodkowie: `.portal-content-contrainer`, `.portal-contrainer`, `body`). Jej bezpośrednie dzieci: `div.portal-breadcrumb > div.breadcrumbs`, `h2.contentheading` z tytułem, `div.article-content`. `h1` w artykule to ramka z telefonem. Wcześniej cała kolumna była odcinana jako panel boczny. Poprawka: wyjątek dla kolumny głównej opisany w Rozpoznawaniu stron; test `live course layout`.
2. Maska `/3625-maska-soprastek-corona.html`: `.ProductContainer` z ID 3625 działał. Okruszki (`.fl.center-sitebar` w `.portal-shop-content` w `.portal-real-content`) i menu VirtueMart linkują kategorie od korzenia (`/80-maski-i-fajki.html`, `/80-maski-i-fajki/139-maski-nurkowe.html`), bez `/sklep-nurkowy/`, więc wcześniej nie było żadnej kategorii. Poprawka: forma od korzenia w sekcji Kategorie; testy `root-form shop categories…` i `a root-form address is a category only…`.
3. Zdjęcia produktów leżą w `/components/com_virtuemart_images/shop_image/product/` (pełny plik w linku, miniatura w `resized/`) i były odrzucane jako zasoby komponentu. Poprawka: wyjątek w sekcji Media; test `VirtueMart catalogue images…`.
4. Bez zmian zostają poprawki koordynatora: `legacyKey` wariantu to `public-option:<SHA-256 nazwy pola + NUL + wartości>` (nazwy pól z `[]` przechodzą walidację klucza importera), a zdjęcia albumu trafiają do `data.photos`, nie do `relations.photos`.

Pozostałe 10 stron z `no-main-content` nie było dostępne w tym module. Jeśli mają ten sam układ co kurs, poprawka 1 je obejmuje; strony listy lub bez `.contentheading` dalej będą raportowane.

5. Ryzyko z poprzedniej wersji tej notatki: okruszki zagnieżdżonego adresu produktu kończące się linkiem do jego krótkiego adresu tworzyły fałszywą kategorię, gdy krótki adres nie był przechwycony. Poprawka: wykluczenie po `rel=canonical` i `h1` produktu (sekcja Kategorie); fixture `product-breadcrumb-self.html`, test `a breadcrumb link to the product's own short address never becomes a category`. Fixture odtwarza opisany kształt, nie pochodzi z przechwyconej strony.

## Testy

`tests/source-content-parser.test.ts` (Node `node:test`, uruchamia Pythona). Gdy obok jest `src/lib/import/bundle.ts`, testy dodatkowo sprawdzają wynik przez `validateBundle`: fixtures z układu żywej strony, konflikty tras, limity pól, linki i okruszki.

```sh
pnpm test                                           # w repo aplikacji
node --test tests/source-content-parser.test.ts     # bez zależności (Node ≥ 22.18)
```

## Weryfikacja koordynatora 09.10

Na rzeczywistych odszyfrowanych kopiach potwierdzono główną kolumnę aktualności, siedem publicznych opisów kadry w kontakcie, specjalizacje PADI, literalny miesiąc JEvents oraz strony nadrzędne galerii. Trzy sprawdzone foldery Phoca zachowują tytuły, odnośniki i 65 wskazanych miniatur. Różne bajty formularzy nie odrzucają identycznej treści; różne ceny, treści lub SEO pod tym samym adresem nadal są konfliktem.

Źródło nadal nie jest aktualnym eksportem SQL. Brak dat publikacji, stanów magazynowych, limitów, kompletu wariantów i historii kalendarza jest rozliczany jako brak danych, bez ich wymyślania.
