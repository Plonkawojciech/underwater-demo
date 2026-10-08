# Underwater — przegląd UI

Etap 2 (pełne szablony) jest na dole dokumentu. Etap 1 zostaje bez zmian jako zapis wcześniejszej pracy.

# Etap 1

Data: 8 października 2026. Gałąź: `codex/underwater-ui-20261008`, baza `4a29273`. Wykonawca: Claude Opus 5.5 (high), delegacja z planu domknięcia (UW-05, część wstępna).

## 1. Plan projektu

Kierunek „od powierzchni w głąb” jest zaakceptowany przez klienta. Ten etap go nie zmienia: poprawia czytelność, hierarchię, obsługę z klawiatury i telefonu oraz dokłada brakujące elementy do przyszłych szablonów.

### Kolory

| Token | Wartość | Rola |
|---|---|---|
| `--abyss` | `#04121A` | Tło nagłówka, hero, stopki |
| `--shell` | `#F2EFE9` | Tło treści i sklepu |
| `--ink` | `#0A1A22` | Tekst na papierze |
| `--brass` / `--brass-lift` | `#C98B45` / `#E2A961` | Akcent: przyciski, znaczniki, focus na ciemnym tle |
| `--brass-ink` (nowy) | `#8A5A22` | Mosiądz w tekście i focus na jasnym tle. Kontrast ok. 5,1:1 do `--shell` (stary `--brass` miał 2,5:1) |
| `--mist` (przyciemniony) | `#4F6672` zamiast `#5C7480` | Tekst pomocniczy. Kontrast ok. 5,3:1 do `--shell` (wcześniej ok. 4,3:1, poniżej AA dla małego tekstu) |

Wartości kontrastu policzono z luminancji względnej WCAG. Nie mierzono ich narzędziem w przeglądarce.

### Typografia

Bez zmian w doborze krojów: Newsreader do nagłówków, Archivo do tekstu, IBM Plex Mono do danych (głębokość, cena, termin, numer). Zmiany dotyczą wyłącznie czytelności: etykiety mono w treści z 9–10 px do 11 px (podpis pod logo i opis pod głębokością w drabinie: 10 px), łamanie długich słów w nagłówkach, długie treści w kolumnie do ok. 68 znaków z interlinią 1,7.

### Układ

```
mobile ≤ 979 px                         desktop ≥ 980 px
┌──────────────────────────────┐        ┌───────────────────────────────────────────┐
│ topline: kurs + data (zawija)│        │ topline: najbliższy kurs + data   telefon │
├──────────────────────────────┤        ├───────────────────────────────────────────┤
│ ▲ logo        [koszyk][menu] │ sticky │ logo   Kursy  Sklep  Kontakt   [koszyk]   │
│ ┌──────────────────────────┐ │        └───────────────────────────────────────────┘
│ │ Kursy nurkowania         │ │ szuflada w sticky headerze,
│ │ Sklep                    │ │ Esc zamyka i wraca focusem do przycisku
│ │ Kontakt                  │ │
│ │ Koszyk (3)               │ │
│ └──────────────────────────┘ │
```

Wyrównanie do lewej w całym serwisie, jak dotąd. Termin i cena w drabinie kursów zostają widoczne na telefonie jako druga linia pod nazwą.

### Zasady

1. Jedno charakterystyczne miejsce zostaje bez zmian: drabina kursów z głębokością w mono. Nowe elementy są ciche.
2. Nowe komponenty nie dokładają kolejnych etykiet wersalikami ani strzałek; piszą zdaniami.
3. Dane na ekranie pochodzą wyłącznie z CMS lub propsów. Komponenty nie mają domyślnych terminów, cen, stanów ani obietnic dostawy.
4. Focus widoczny na każdym tle: `--brass-ink` na papierze, `--brass-lift` na granacie.
5. Ruch tylko w odpowiedzi na działanie (przycisk menu, dodanie do koszyka); `prefers-reduced-motion` go wyłącza.

### Kontrola planu względem briefu

- Pierwsza wersja zakładała osobny pasek ostrzeżeń w kolorze mosiądzu nad każdym szablonem. Odrzucone: to dekoracja, a komunikaty i tak mają własny komponent `Notice`.
- Paginacja miała mieć numery w mono z kreskami jak na głębokościomierzu. Odrzucone jako ozdobnik powtarzający motyw drabiny. Zostały proste numery z wyraźnym stanem bieżącej strony.
- Kolory statusów (`Notice`) wywiedzione z palety: granat, mosiądz, czerwień błędu z formularzy i jeden stonowany zielony. Bez pastelowych teł z SaaS.

## 2. Co zmieniono

Zmienione wyłącznie pliki przydzielone w zleceniu. Bez commitu.

| Plik | Zmiana |
|---|---|
| `src/components/Header.tsx` | Szuflada mobilna przeniesiona do sticky headera (wcześniej leżała w przepływie strony i po przewinięciu otwierała się poza ekranem). Esc zamyka i oddaje focus przyciskowi, klik poza szufladą i w link też zamyka. `aria-expanded`, `aria-controls`, `aria-current="page"`, etykieta „Otwórz/Zamknij menu”, link „Przejdź do treści”. Koszyk ma dostępną nazwę z liczbą sztuk; w szufladzie dodany koszyk. Nowe opcjonalne propsy `nav?: NavItem[]` i `phone?: string`, eksport `NavItem` i `DEFAULT_NAV`. Wywołanie `<Header />` działa bez zmian |
| `src/components/ProductCard.tsx` | Cena promocyjna/regularna opisana dla czytnika ekranu (sam `<s>` nie jest odczytywany). Promocja tylko gdy `salePrice < price`. Etykieta „Chwilowo niedostępny” według stanu z CMS (suma wariantów albo stan produktu). Zdjęcie w linku z `alt=""`, bo nazwa produktu jest obok. Brak zdjęcia nie zostawia pustej ramki |
| `src/components/AddToCart.tsx` | Ilość jako pole liczbowe z przyciskami, ograniczona do stanu wariantu/produktu minus to, co już leży w koszyku (maks. 99). Domyślnie wybrany pierwszy dostępny wariant. Wariant ma klucz `id || sku || label`; do koszyka trafia `variantId` obok etykiety. Komunikat po dodaniu w `role="status"` z linkiem do koszyka, błąd dodania widoczny. Unikalna nazwa grupy radio (`useId`). Naprawiony przycisk: klasa `btn-accent` nie istniała w CSS, teraz `btn-solid`. Miniatury galerii: „Zdjęcie 2 z 4”, `aria-pressed` |
| `src/components/cart.tsx` | Walidacja localStorage: czyste, eksportowane `parseCart`, `normalizeLine`, `clampQty`, `sameLine`, `cartTotal`, `cartCount`. Odrzuca złe id, slug (w tym `//host`), nazwę, cenę (ujemna, nieskończona, tekst, > 1 mln), ilość (0, ujemna, NaN); ułamki zaokrągla w dół, ilość ogranicza do 99 i do `maxQty`. Łączy duplikaty, także linię zapisaną tylko z etykietą z linią z `variantId`. Obrazek tylko ścieżka względna lub https. Maks. 50 linii. Suma liczona w groszach. Błąd zapisu/odczytu storage nie psuje koszyka (`persisted: false`). Synchronizacja między kartami przez zdarzenie `storage`. `add` zwraca `boolean`. Dotychczasowe eksporty (`CartLine`, `lineKey`, `CartProvider`, `useCart`, pola kontekstu) zostały |
| `src/app/(site)/globals.css` | Tokeny kontrastu, focus na każdym tle, `.sr-only`, szuflada, szerokości 320–360 px, termin/cena w drabinie kursów na telefonie, zawijanie paska z datą kursu, warianty i ilość, focus pól formularza, większe cele dotyku, style komponentów treści, `prefers-reduced-motion` obejmuje też `scroll-behavior` i pseudo-elementy |
| `src/components/content/*` | Nowe komponenty prezentacyjne, opisane niżej |

### Komponenty w `src/components/content/`

Wszystkie bez pobierania danych, bez `dangerouslySetInnerHTML` i bez domyślnych treści. Import: `import { Prose, Pagination, … } from '@/components/content'`.

| Komponent | Do czego |
|---|---|
| `Prose` | Kolumna czytania dla długich treści (h2–h4, listy, cytaty, tabele, obrazy, linki). Styluje dzieci; oczyszczony HTML wstawia wywołujący. Wariant `dark` na granat |
| `PlainText` | Tekst ze źródła jako akapity (pusta linia = akapit, pojedyncza = `<br>`). React escapuje znaczniki |
| `TableScroll` | Szeroka tabela przewija się w swoim polu zamiast poszerzać stronę; region z etykietą i focusem |
| `Pagination`, `pageWindow`, `RangeSummary` | Stronicowanie archiwów i katalogu. Adresy podaje router przez `hrefFor(n)`; komponent nie narzuca schematu URL. Na telefonie „Strona 3 z 12” zamiast listy numerów |
| `EmptyState` | Pusta lista: tytuł, wskazówka, akcja |
| `Notice` | Komunikat info/success/warning/error; `live` tylko po akcji użytkownika |
| `DateText`, `DateRange` | Data z rekordu w czasie warszawskim, `<time datetime>`. Nieprawidłowa lub pusta wartość nic nie renderuje |
| `ArchiveList`, `ArchiveItem` | Lista aktualności, relacji, wyjazdów: tytuł, data, krótki opis, opcjonalne zdjęcie i fakty z rekordu |

## 3. Usunięte twierdzenia

AddToCart pokazywał na stałe „Wysyłka w 24 h lub odbiór w Warszawie, ul. Okopowa 31.” oraz „Zapytaj o termin dostawy: 504 16 20 14.”. Czas wysyłki nie ma źródła ani działającej integracji dostaw, a telefon był wpisany w kod zamiast pochodzić z ustawień. Teraz komponent mówi tylko to, co wynika z danych (dostępne sztuki, brak, ile jest już w koszyku), a przy braku linkuje do kontaktu. Potwierdzoną informację o dostawie można przekazać propsem `note`.

## 4. Samokrytyka

- Sprawdziłem plan względem briefu: nie dodałem nowych etykiet wersalikami ani strzałek w nowych komponentach. Istniejące etykiety mono wersalikami zostały, bo należą do zaakceptowanego kierunku.
- Przyciemnienie `--mist` i obramowań pól formularza (ink 45% zamiast 12%) widać gołym okiem. To świadomy koszt zgodności z WCAG 1.4.3 i 1.4.11; obramowania kart i linii podziału zostały bez zmian.
- Cyfry głębokości w drabinie są teraz w `--brass-deep` (#A86F2E) na papierze, nieco ciemniejsze niż dotąd. Na granacie bez zmian.
- Reguła dostępności „kupić można tylko przy dodatnim, znanym stanie” jest ta sama w karcie i w AddToCart. Brak stanu w rekordzie oznacza „Chwilowo niedostępny”. Jeśli źródło VirtueMart pozwala zamawiać bez stanu, trzeba to zmienić w obu miejscach razem z serwerem.
- `maxQty` w linii koszyka to stan z chwili dodania; po zmianie stanu w CMS bywa nieaktualny. Ogranicza tylko UI.
- Szerokości 320/375/390 px policzyłem z rozmiarów elementów (320 px: ok. 245 px treści nagłówka na 288 px dostępnych; 375 px: ok. 316 na 327). To obliczenie, nie zrzut ekranu.

## 5. Weryfikacja

**Nie wykonano typecheck, testów ani QA w przeglądarce.** W tej sesji każde uruchomienie `pnpm`, `tsc` (także przez `node node_modules/typescript/bin/tsc`) i skryptów `node` wymagało zatwierdzenia, którego nie było. Działał tylko `node --version` (v22.22.0). Typy przejrzałem ręcznie; to nie zastępuje `tsc`.

Gotowe testy (poza repo, bez nowych zależności; transpilują pliki repo lokalnym TypeScriptem i uruchamiają `node:test`):

```
node --test /tmp/uw-ui-tests/cart.test.mjs      # 18 testów walidacji koszyka
node --test /tmp/uw-ui-tests/content.test.mjs   # pageWindow, Pagination, RangeSummary, PlainText, DateText
pnpm typecheck
```

Przypadki w `cart.test.mjs`: uszkodzony/niepoprawny JSON i nie-tablica; elementy nie będące obiektem; id 0, ujemne, ułamkowe, tekstowe, poza bezpiecznym zakresem; slug `//evil.com/x`, `/abs`, `a//b`, `javascript:`, spacje, `../x`, polskie znaki; nazwa pusta i > 200 znaków; cena `1e309`, ujemna, tekst, > 1 mln, 0 dozwolone; ilość 0, ujemna, tekst, `0.5`, `2.7 → 2`, `"3" → 3`, `1000 → 99`, `maxQty`; scalanie duplikatów z limitem; linia z etykietą + linia z `variantId`; różne `variantId` z tą samą etykietą; zły `variantId`; obrazek `//host`, `/\host`, `javascript:`, `http:`, `data:`; limit 50 linii; klucz `__proto__` i nadmiarowe pola; suma w groszach (`0.1 × 3 = 0.3`); zgodność `lineKey`; stabilność zapisu i odczytu (brak pętli między kartami).

Do sprawdzenia w przeglądarce przez koordynatora: 320/375/390/768/1440 px na stronie głównej, w sklepie, na produkcie, w kursie i koszyku; Tab przez nagłówek (skip link, menu, Esc), wybór wariantu strzałkami, pole ilości, czytnik ekranu dla ceny promocyjnej i komunikatu „Dodano”; koszyk w trybie prywatnym Safari i z ręcznie zepsutym `uw-cart`; dwie karty.

## 6. Do zrobienia przez koordynatora (pliki poza tym etapem)

1. `src/app/(site)/layout.tsx`: `<main id="tresc">`; opcjonalnie `<Header phone={s.phone} />`. Skip link działa też bez tego (fokusuje `<main>` skryptem).
2. `src/views/shop.tsx`: w mapowaniu wariantów dodać `id: v.id` (stabilny klucz już istnieje w Payload); ewentualnie `note` z potwierdzoną informacją o dostawie.
3. Serwer zamówienia: ignorować `price` z przeglądarki, walidować `id`, `variantId`/`variant`, ilość całkowitą 1–99 i stan. UI ogranicza ilości wyłącznie dla wygody.
4. `CartPage`: może korzystać z `persisted` (komunikat `Notice`, gdy koszyk nie zapisuje się w przeglądarce) i z `line.maxQty` do blokowania „+”. Tekst „Potwierdzenie poszło e-mailem” nadal jest nieprawdziwy (P1 w planie).
5. Wzorzec sluga w koszyku: `[A-Za-z0-9_-]` z segmentami rozdzielonymi `/`. Jeśli inwentarz pokaże inne znaki w adresach produktów, trzeba rozszerzyć regex `SLUG` w `cart.tsx`; inaczej dodanie takiego produktu pokaże błąd.
6. `src/lib/data.ts`: `dateLong`/`dateShort` formatują w strefie serwera (Coolify zwykle UTC), co może przesunąć datę o dzień. `DateText` używa `Europe/Warsaw`.
7. Widoki: `rowlink` zawiera `<p>` wewnątrz `<span>` w linku (niepoprawne zagnieżdżenie), pasek faktów na stronie głównej (1998, 3 federacje, 4 osoby, 40 m) i wrześniowe terminy demo wymagają potwierdzenia w źródle.

# Etap 2 — pełne szablony

Data: 8 października 2026. Worktree `underwater-opus-ui-20261008`, gałąź `codex/underwater-ui-20261008`, baza `4a29273` plus niezacommitowany etap 1. Wykonawca: Claude Opus 5.5 (high). Bez commitu, bez uruchamiania serwera.

Punkty 1, 2, 5, 6 i 7 z listy etapu 1 są zamknięte w tym etapie (`<main id="tresc">`, `variantId` z wiersza Payload, slug Unicode, daty w `Europe/Warsaw`, poprawne zagnieżdżenie w drabinie, usunięty pasek faktów i terminy demo). Punkt 3 zrealizował koordynator po stronie serwera, punkt 4 zastąpiła nowa strona koszyka.

## 1. Plan projektu i kontrola względem briefu

Tokeny, kroje i zasady z etapu 1 bez zmian: granat `--abyss`, papier `--shell`, mosiądz `--brass`/`--brass-ink`, Newsreader, Archivo, IBM Plex Mono. Nowe szablony składają się z istniejących elementów:

| Szablon | Konstrukcja |
|---|---|
| Kalendarz | Ta sama drabina co kursy. W kolumnie, gdzie przy kursie stoi głębokość, stoi data. Miesiące jako nagłówki sekcji, nawigacja poprzedni/następny miesiąc |
| Terminy kursu | Lista pod opisem: daty w mono, nazwa terminu i miejsce, cena i wolne miejsca tylko gdy są w rekordzie |
| Wyprawy | Karta z poziomym zdjęciem na papierze; szczegół w ciemnym nagłówku jak kurs |
| Galerie | Jedyne miejsce, gdzie zmienia się tło: lista albumów i album na granacie, lightbox pełnoekranowy na granacie |
| Aktualności, relacje, strony CMS, dokumenty | Archiwum z etapu 1 i kolumna czytania `longform` |
| Koszyk i zamówienie | Układ z demo; sumy jako lista `dl` w mono, dostawa jako radio z ceną |

```
kalendarz ≥760 px
┌──────────┬────────────────────────────────────────┐
│ 12 paź   │ PADI Open Water Diver                  │
│ (mono)   │ 12–14 października 2026, Warszawa      │
├──────────┼────────────────────────────────────────┤
```

Co odrzuciłem po porównaniu z briefem: osobny układ kart dla kalendarza (powtarzałby siatkę sklepu, a kalendarz to sekwencja dat, więc drabina pasuje lepiej), numerowane etykiety terminów (to nie są kroki), animowane przejścia w lightboxie (ruch tylko po działaniu użytkownika, i tak wyłączany przez `prefers-reduced-motion`).

## 2. Trasy i szablony

| Adres | Widok | Dane |
|---|---|---|
| `/` | `app/(site)/page.tsx` | Ustawienia, kursy (`order`), najbliższe terminy, wyprawy, wydarzenia, wyróżnione produkty, aktualności. Sekcja bez danych się nie pokazuje |
| `/sklep-nurkowy.html` | `ShopIndex` | Wyszukiwanie `?q=` (nazwa, producent, SKU), paginacja `?strona=` po 24 |
| `/{slug}.html` (dowolna głębokość, Unicode) | `CategoryPage` / `ProductPage` | Kategoria obejmuje całe poddrzewo i `categories` (hasMany); produkt: warianty z własną ceną, JSON-LD, powiązane z tej samej kategorii |
| `/kursy-nurkowania.html` | `CoursesIndex` | Filtr federacji `?org=`, paginacja, najbliższy termin z `course-sessions` |
| `/kursy-nurkowania/{slug}.html` | `CoursePage` | Treść `body` przez `SafeHTML`, inaczej sekcje, inaczej pusty stan. Terminy przyszłe, wolne miejsca, formularz z wyborem terminu |
| `/kalendarz.html` | `CalendarPage` | Domyślnie niezakończone wydarzenia; `?miesiac=RRRR-MM` w czasie warszawskim |
| `/wyprawy.html` | `TripsIndex` | Najbliższe / `?widok=minione` |
| `/aktualnosci.html`, `/relacje.html` | `ArticleIndex` | `pages` o `kind` news / report, od najnowszych |
| `/galerie.html` | `AlbumsIndex` | Albumy od najnowszych, okładka z pierwszego zdjęcia |
| ścieżka z `Pages/Trips/Albums/Events.path` | `ArticlePage`, `TripPage`, `AlbumPage` (48 zdjęć na stronę), `EventPage` | |
| `/kontakt.html` | `ContactPage` | Dane z ustawień, formularz kontaktu i newslettera |
| `/koszyk` | `CartPage` | Wycena i zamówienie przez API koordynatora |
| `/platnosc-testowa?token=` | `TestPayment` | `GET/POST /api/payments/test` |
| `/newsletter/potwierdz?token=`, `/newsletter/wypisz?token=` | `NewsletterToken` | POST dopiero po kliknięciu; samo otwarcie linku nic nie zmienia |
| 404, ładowanie, błąd | `not-found.tsx`, `loading.tsx`, `error.tsx` | Błąd nie pokazuje szczegółów, tylko `digest` |

Kolejność rozwiązywania adresu (`src/views/resolve.ts`, jedno zapytanie na żądanie dzięki `React.cache`, wspólne dla metadanych i strony):

1. Stałe sekcje (`sklep-nurkowy`, `kursy-nurkowania`, `kontakt`, `wyprawy`, `kalendarz`, `aktualnosci`, `relacje`, `galerie`), z `.html` i bez.
2. Opublikowany rekord z dokładnym `legacyPath` w każdej kolekcji treści. Porównywane formy: zdekodowana i zakodowana, z ukośnikiem i bez.
3. `kursy-nurkowania/{slug}`.
4. `products.slug`, `categories.slug`, potem `path` w `pages`, `trips`, `albums`, `events` (z `.html` i bez, z ukośnikiem i bez).
5. Opublikowany `redirects.from` → 301 na `to`, tylko gdy nic innego nie pasuje i `to` jest ścieżką tej witryny.

Segmenty są dekodowane i normalizowane do NFC; `..`, zakodowany `/` lub `\` i znaki sterujące dają 404. Nie ma bramki „ID liczbowe na początku”.

Canonical: `legacyPath`, jeśli to zwykła ścieżka witryny, w przeciwnym razie zbudowany adres. Pochodzenie z `NEXT_PUBLIC_SERVER_URL` (`metadataBase`). Każda strona ma `noindex, nofollow` dopóki `UNDERWATER_ENVIRONMENT` nie jest `production` (dziś zawsze). SEO `title/description/image` z rekordu mają pierwszeństwo.

## 3. Dostęp do danych

Wszystkie publiczne odczyty idą przez `src/views/query.ts`:

- `overrideAccess: false` bez użytkownika, czyli reguły dostępu anonimowego z kolekcji;
- dodatkowo jawny warunek `published = true` (druga bariera, gdyby reguła dostępu się zmieniła);
- `limit` 1–500, `depth` 0–2, `page` 1–1000; listy po 24;
- drzewo kategorii jednym zapytaniem z `select` (tylko nazwa, slug, rodzic, kolejność).

Widoki nie wywołują Payload bezpośrednio. Typy w tym drzewie są starsze niż schemat koordynatora, dlatego `presentation.ts` ma wąskie typy odczytu, a `query.ts` rzutuje Local API na minimalny interfejs. Po integracji można je zastąpić wygenerowanymi typami.

Długie treści HTML renderuje wyłącznie `SafeHTML` koordynatora, przez `RichBody` (jedno miejsce wywołania, klasy `longform`). Wyjątek do decyzji koordynatora: `JsonLd` w `components/content/Meta.tsx` używa `dangerouslySetInnerHTML` dla `<script type="application/ld+json">`. Przyjmuje tylko obiekt, serializuje go przez `JSON.stringify` i zamienia `<`, `>`, `&`, U+2028, U+2029 na sekwencje `\u…`; test sprawdza, że `</script>` nie zamyka znacznika. Bez tego React zamieniłby cudzysłowy na encje i JSON-LD byłby nieważny.

## 4. Koszyk, zamówienie, płatność, formularze

Koszyk (`cart.tsx`): ceny w groszach (`priceCents`), stare koszyki z `price` w złotych są przeliczane przy odczycie. Slug przyjmuje litery dowolnego alfabetu, odrzuca `..`, `//`, schematy i spacje. Wariant: stabilne `variantId` (id wiersza Payload) i osobno `sku`.

Karta produktu: cena wariantu z `priceCents` zastępuje cenę produktu i jego promocję (ta sama reguła co w `quote.ts` koordynatora). Promocja tylko gdy jest realną obniżką większą od zera.

`CartPage`:

- do `/api/store/quote` idą tylko `id`, `variantId`, `variant`, `qty` i `deliveryMethod`; żadnej ceny;
- wycena po każdej zmianie pozycji lub dostawy, z opóźnieniem 250 ms, `AbortController` i licznikiem żądań, więc spóźniona odpowiedź nie nadpisze nowszej;
- przycisk zamówienia jest nieaktywny, dopóki nie ma wyceny dla bieżącego koszyka i dopóki wycena nie obejmuje dokładnie tych samych pozycji i ilości;
- `idempotencyKey` z `crypto.randomUUID()` (z zapasową implementacją v4), ten sam przy ponowieniu identycznego zamówienia, także po odświeżeniu karty; nowy po każdej zmianie danych. W `sessionStorage` leży tylko skrót FNV-1a danych i klucz, bez danych osobowych;
- błąd albo odrzucenie zostawia koszyk i klucz, odświeża wycenę; przyjęte zamówienie czyści koszyk;
- przejście tylko na `/platnosc-testowa` w tym samym originie (`safePaymentPath`); inny adres nie jest otwierany;
- wyraźna informacja o zamówieniu testowym nad formularzem i na stronie płatności.

`/platnosc-testowa`: przyciski „Symuluj udaną płatność / odrzucenie / Anuluj” tylko przy statusie `pending` przed `expiresAt`. Status zawsze z odpowiedzi serwera. Nieprawidłowy token nie wywołuje API. `referrer: no-referrer`.

Formularze (`SignupForm`, `ContactForm`, `NewsletterForm`): `useActionState` z akcjami z `@/lib/actions`, pola zgodne z `fromForm` koordynatora (`privacyAccepted`, `consent`, `course`, `session`, honeypot `website`). Komunikat sukcesu pochodzi z serwera; UI nie twierdzi, że e-mail został wysłany. Wybór terminu: terminy bez miejsc są nieaktywne, jest opcja „Inny termin, do ustalenia”.

Prywatność: domyślnie tylko niezbędne. „Ustawienia prywatności” w stopce otwierają natywny `<dialog>` (pułapka fokusu, Esc, powrót fokusu). W podglądzie statystyka jest wyłączona i nie da się jej włączyć; żaden skrypt analityczny nie istnieje. Znacznik „Wersja podglądowa” w lewym dolnym rogu nie przechwytuje kliknięć.

Dokumenty prawne: linki w stopce, przy zgodach i w koszyku pochodzą z opublikowanych `pages` o `kind = legal` (rola rozpoznawana po tytule lub ścieżce: prywatność, regulamin). Gdy ich nie ma, w tych miejscach jest zdanie, że dokument nie jest jeszcze opublikowany w wersji podglądowej. Strona `legal` bez treści pokazuje ostrzeżenie, że to nie jest obowiązujący tekst.

## 5. Usunięte twierdzenia

Z kodu UI usunięto: pasek faktów (1998, 3 federacje, 4 osoby, 40 m), opis wypraw (Malta, Gozo, „instruktor z Warszawy”, „plan przy kawie”), „Grupy do czterech osób”, „Kurs można rozłożyć na raty”, „pięć minut od Ronda Daszyńskiego”, „przyjmujemy sprzęt do serwisu”, „od 1998 roku” i „gwarancja najniższej ceny” w opisie strony i stopce, „Oddzwaniamy w ciągu jednego dnia roboczego”, „Potwierdzenie poszło e-mailem”, „Przelewy24, BLIK, karta albo odbiór osobisty na Okopowej”, tekst o przenoszeniu opisów „przy wdrożeniu”, wpisany na sztywno adres w sekcji kontaktu, „Demo nowej strony · Programo s.j.” w stopce, `nextDate` kursów (terminy pochodzą tylko z `course-sessions` i tylko przyszłe), `Settings.banner` w pasku nad nagłówkiem (zastąpiony najbliższym opublikowanym terminem).

Zostały pola CMS, które UI renderuje tylko gdy są wypełnione: `heroTitle`, `heroText`, `priceGuarantee`, `includes`, `warranty`. Seed koordynatora wpisuje w nie niepotwierdzone treści (szczegóły w `docs/opus-backend-review.md`, U-16).

## 6. Do zrobienia przez koordynatora przy integracji

1. Skopiować pliki z tego worktree; `SafeHTML`, `createContact` i `subscribeNewsletter` już istnieją u koordynatora z sygnaturami zgodnymi z wywołaniami (sprawdzone czytaniem plików).
2. `package.json`: `"test": "tsx --test tests/*.test.ts"` nie obejmuje `tests/ui/`. Proponuję `tests/**/*.test.ts`.
3. Zdecydować o wyjątku JSON-LD (punkt 3).
4. Sitemap: wspólne funkcje `hrefOf` i `canonicalPath` są w `views/meta.ts` i `lib/presentation.ts`.
5. Stare adresy z parametrami (`index.php?option=…`) nie trafiają do trasy `[...slug]`; mapa źródłowa musi je obsłużyć w `proxy.ts` albo w osobnej trasie.
6. `src/app/(site)/robots.ts` i `src/app/robots.ts` definiują ten sam plik; zostawiłem bez zmian, bo tak było w zaakceptowanym buildzie.

## 7. Weryfikacja

Wykonane w tym worktree:

| Polecenie | Wynik |
|---|---|
| `pnpm typecheck` | 3 błędy, wszystkie z brakujących tu plików koordynatora: `@/components/SafeHTML` (TS2307), `createContact` i `subscribeNewsletter` w `@/lib/actions` (TS2305) |
| `pnpm exec tsc -p /tmp/uw-tsc/tsconfig.json` (ten sam tsconfig plus deklaracje tych trzech symboli z sygnaturami odczytanymi u koordynatora; plik poza repo) | 0 błędów |
| `pnpm exec tsx --test tests/ui/presentation.test.ts tests/ui/cart.test.ts` | 29/29 zaliczonych |

Testy obejmują: dekodowanie i odrzucanie segmentów adresu, formy `legacyPath`, slug Unicode, bezpieczne linki i obrazy, canonical, ceny (grosze, złote, promocja, wariant, zakres), stany, parametry zapytań, drzewo kategorii z cyklem i brakującym rodzicem, granice miesięcy w czasie warszawskim ze zmianą czasu, wolne miejsca, przekierowanie płatności tylko w tym samym originie, tokeny, odcisk zamówienia, walidację wyceny, JSON-LD bez ocen i z ucieczką `</script>`, zgodę domyślną, migrację koszyka, limity koszyka.

Nie wykonano (granice tego etapu):

- `next build` i serwer deweloperski — zabronione w zleceniu; nie sprawdziłem więc renderowania, hydratacji, zachowania `permanentRedirect` ani rzeczywistych zapytań do bazy z jej schematem;
- przeglądarka: żadnych zrzutów 320/375/390/768/1440, testu klawiatury, czytnika ekranu ani kontrastu narzędziem. Układ mobilny wynika z CSS, nie z obserwacji;
- przepływ koszyk → wycena → zamówienie → płatność testowa → status na prawdziwym API koordynatora;
- formularze z prawdziwymi akcjami (zgodność pól sprawdzona tylko czytaniem `lib/actions.ts` i `lib/forms/service.ts`).

Do sprawdzenia w przeglądarce po integracji: wszystkie trasy z tabeli w punkcie 2 na pięciu szerokościach; menu przy 1099/1100 px (siedem pozycji, próg szuflady przesunięty z 980 na 1100 px); Tab przez nagłówek, filtry, drzewo kategorii, lightbox (strzałki, Esc, powrót fokusu) i okno prywatności; wycena przy szybkich zmianach ilości; ponowienie zamówienia po zerwaniu sieci (ten sam numer); płatność po `expiresAt`; adres z polskimi znakami i `legacyPath`.
