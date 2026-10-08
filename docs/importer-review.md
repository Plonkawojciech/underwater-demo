# Importer — poprawki N-8…N-10 i P3

Stan na 2026-10-08, worktree `underwater-opus-ui-20261008`, gałąź `codex/underwater-ui-20261008`, bez commita. Zmienione pliki: `src/lib/import/bundle.ts`, `src/lib/import/service.ts`, `scripts/import/import-bundle.ts`. Nowe: `tests/import-bundle.test.ts`, `tests/import.test.ts`, ten plik. Schematu, migracji, typów Payload i zależności nie ruszałem.

## Co robi importer teraz

Kolejność jednego przebiegu:

1. **Walidacja paczki (czysta, przed jakimkolwiek odczytem bazy).** Każde z dziewięciu kolekcji ma pełną specyfikację pól: typ, wymagalność, zakres, opcje selectów, limity długości. Nieznane pole, nieznana kolekcja, `id` w wierszu tablicy, pola księgowe (`legacyKey`, `sourceHash`, `reserved`) i dowolny klucz koperty encji kończą się `ImportError`. `published` musi być jawnym booleanem. Daty są normalizowane do ISO.
2. **Relacje.** Mapa pole → kolekcja docelowa i liczność (`products.category → categories:` pojedyncza i wymagana, `products.images → media:` lista itd.). Zły prefiks, lista zamiast pojedynczej wartości, duplikat w liście, odwołanie do nieistniejącej encji lub mediów spoza paczki: błąd. Zagnieżdżone media (`seo.image`, `variants[].image`, `photos[].image`, `settings.heroImage`) przyjmują wyłącznie `media:<key>` z paczki. Numeryczne ID z bazy nie przejdą nigdzie.
3. **Ścieżki i unikalność.** `legacyPath`, `path`, `from`, `to`: dekodowanie, NFC, odrzucenie `%2F`, `%5C`, `%00`, `..`, `//`, znaków sterujących i niewidocznych (`\p{Cf}`, w tym bidi). Jedna globalna mapa adresów publicznych (slug produktu i kategorii, `kursy-nurkowania/<slug>`, `path`, `legacyPath`, `from` przekierowania, porównanie bez `.html` i końcowego ukośnika). Kolizja dwóch encji to błąd. Do tego unikalność `slug`, `vmId`, `path`, `from` w kolekcji, unikalne `legacyKey`, `sku` i etykiety wariantów w produkcie. Cykle relacji i pętle przekierowań są odrzucane. Adresy zasłonięte przez stałe sekcje i trasy aplikacji (`/kontakt.html`, `/koszyk/...`, `/`) nie blokują importu, ale trafiają do `unresolved` jako `route-shadowed` (N-6).
4. **Ustawienia.** Allowlista z typami (`email`, HTTPS tylko na facebook.com / youtube.com / youtu.be, `heroImage` jako `media:`). `deliveryMethods` i pola spoza listy są odrzucane przed zapisem. Global nie ma pola pochodzenia, więc importer uzupełnia tylko puste wartości. Równe pomija, różne zgłasza jako `settings-conflict:<pole>`.
5. **Pliki mediów.** Ścieżka w katalogu snapshotu (realpath, bez symlinków, bez `.env*`), rozszerzenie, maksymalnie 12 MB, SHA-256. Każdy plik czytany jest do jednego bufora przez `O_NOFOLLOW` i `fstat`, a przed `payload.create` czytany i weryfikowany ponownie (TOCTOU). Do Payload idą dokładnie sprawdzone bajty.
6. **Preflight bazy (tylko odczyt, także w dry run).** Rekord spoza paczki (bez `legacyKey` albo z innym kluczem), który zajmuje adres albo unikalną wartość, przerywa import przed pierwszym zapisem. Zapisane media: zmiana skrótu źródła daje `media-replacement` (oryginał zostaje). Brak pliku na dysku daje `media-file-missing`, niezgodny plik `media-file-mismatch`. Zamiany pliku nie ma nigdy.
7. **Blokada.** Przebieg zajmuje wiersz `import-runs` w transakcji `IMMEDIATE`. Drugi import na tej bazie, dowolnej paczki, dostaje `Another import is already running`. Dzierżawa (domyślnie 5 min) jest odnawiana co 1/3 czasu przez CAS na `updatedAt`. Zgubiona dzierżawa przerywa przebieg. Po awarii procesu wiersz po wygaśnięciu przejmuje następny import. Błąd w trakcie oznacza przebieg `failed` w `catch`.
8. **Encje** w kolejności Kahna, O(V+E), niezależnej od kolejności w paczce. Każda w osobnej transakcji. Liczniki, ID i pozycje do przeglądu są aktualizowane dopiero po zatwierdzeniu, więc ponowienie po `SQLITE_BUSY` niczego nie liczy dwa razy.
9. **Uzgodnienie przy każdym przebiegu.** Nie ma już skrótu `alreadyComplete`. Każdy klucz paczki jest sprawdzany w bazie (`reconcile-missing`), usunięty rekord zostaje odtworzony. Dla zweryfikowanego zrzutu Joomli zaimportowane rekordy spoza paczki są zgłaszane jako `not-in-bundle`.

## Ręczne edycje a stan magazynu (N-10)

`sourceHash` ma postać `v2:<skrót przygotowanych danych>:<skrót projekcji po zapisie>`. Projekcja obejmuje wszystkie pola zarządzane przez import. Pomija `products.stock`, `variants[].stock`, `variants[].id`, `reserved` i znaczniki czasu. Rezerwacja zamówienia lub miejsca nie jest więc ręczną edycją. Wersja importera wchodzi do obu skrótów i do `runKey`, dlatego nowy importer przelicza wszystko od nowa.

| Sytuacja | Wynik |
|---|---|
| Brak rekordu | `create` |
| Projekcja zgodna, źródło bez zmian | `unchanged` |
| Projekcja zgodna, źródło zmienione | `update` |
| Projekcja zmieniona przez zespół, źródło bez zmian | `preserved`, bez pozycji do przeglądu |
| Projekcja i źródło zmienione | `manual-edit` w `unresolved`, rekord nietknięty |
| `sourceHash` w nieznanym formacie | `manual-edit`, nic nie jest nadpisywane |

Magazyn i miejsca:

- Stan ze źródła wchodzi tylko przy utworzeniu produktu albo nowego wiersza wariantu. Przy aktualizacji importer nie wysyła `stock`.
- Brak stanu wariantu w źródle zapisuje `null`, nie zero. Hook katalogu liczy wtedy stan produktu jako `null`. Produkt bez wariantów i bez stanu też dostaje `null`.
- Warianty dopasowuję po `legacyKey`, potem `sku`, potem etykiecie (NFC, bez wielkości liter). Dopasowany wiersz zachowuje swoje `id` i bieżący stan.
- Nowy wiersz jest dodawany. Wiersz istniejący bez odpowiednika w źródle, dopasowanie niejednoznaczne albo przejście z wariantów na brak wariantów (lub odwrotnie) daje `variant-topology`. Rekord zostaje bez zmian, żadnego usuwania ani odtwarzania wierszy.
- `reserved` nie jest na allowliście. `capacity` mniejsze niż bieżące `reserved` daje `capacity-below-reserved` i termin bez zmian.
- Pola nieobecne w źródle są przy imporcie zapisywane jako puste (`null`, `[]`), także przy tworzeniu. Importer nie podstawia więc wartości domyślnych Payload, na przykład `org: 'PADI'`.

## Kompletność (N-9)

`status: complete` i `sourceComplete: true` wymagają kompletu warunków:

- `source.kind === 'joomla-dump'` i `source.complete === true`;
- `verifiedSourceManifestHash` podany przez wywołującego i równy `manifestHash` (porównanie stałoczasowe);
- pusta lista `unresolved` po uzgodnieniu.

`public-pages` i `demo` nigdy nie dają `complete` ani `sourceComplete`, nawet z poprawnym skrótem. Wynik zawiera pole `sourceVerification`: `verified`, `not-a-database-dump`, `declared-incomplete`, `manifest-not-verified` albo `manifest-mismatch`.

CLI liczy skrót samodzielnie: `--source-manifest=<plik>` czyta wskazany plik manifestu i przekazuje jego SHA-256. Flaga `complete` w paczce sama niczego nie dowodzi.

Dry run wykonuje całą walidację, odczyt plików i preflight bazy, symuluje decyzje dla każdej encji (`plan`) i skanuje HTML. Zwraca prawdziwą listę `unresolved` oraz `checked`, czyli listę wykonanych kontroli, i `status: 'dry-run'`, `sourceComplete: false`. Nie zapisuje niczego, nawet wiersza `import-runs`. Dla encji zależnych od rekordów, które jeszcze nie istnieją, plan jest szacunkiem (`created`/`updated`).

## Obrazy w HTML

Kontrakt dla konwertera (`opus-source-converter-brief.md`):

- `media[].url` (opcjonalne) to oryginalny adres obrazu na underwater.pl, absolutny albo od `/`;
- `mediaUrls: [{ key, url }]` to dodatkowe aliasy. Klucz może wskazywać obraz, którego jeszcze nie pobrano;
- `media[].path` służy jako mapowanie zapasowe, `/<path>`, i nigdy nie nadpisuje jawnego `url`. Dwa różne klucze pod jednym adresem to błąd.

`src` w treści przechodzi przez tę samą normalizację co ścieżki. Obsługiwane są: `http`/`https` na `underwater.pl` i `www.underwater.pl`, adres względem protokołu (`//`) i względny `images/...`. Query i fragment są pomijane. Wynik w `unresolved`:

- `html-image-external:<encja>:<host>` — obraz z innej domeny albo `data:`;
- `html-image-unsafe` — niebezpieczna ścieżka;
- `html-image-unmapped:<encja>:<ścieżka>` — adres bez mapowania na media;
- `html-image-not-downloaded:<encja>:<key>` — klucz znany, pliku brak.

Sanitizer usuwa takie obrazy z treści.

Zmiana kontraktu: zdjęcia albumu idą teraz jako `data.photos: [{ image: 'media:<key>', caption }]`. `relations.photos` nie istnieje.

## Testy

```
npx tsx --test tests/import-bundle.test.ts tests/import.test.ts   # 14/14, trzy powtórzenia bez niestabilności
npx tsc --noEmit -p .                                                # bez błędów w plikach importera
```

`tests/import.test.ts` tworzy własny katalog `mkdtemp`, migruje bazę przez `payload.db.migrate()`, generuje syntetyczne PNG przez sharp i usuwa katalog w `after`. Nie używa CLI ani `.env`. Pokrycie:

- zrzut Joomli: bez skrótu, ze złym i z poprawnym skrótem; `public-pages` i `demo` z poprawnym skrótem; `not-in-bundle`;
- 23 uszkodzone DTO (zły cel relacji, liczność, liczbowe ID w mediach, `id` wiersza, pola chronione, brak wymaganych pól, typy, ścieżki, duplikaty, cykl, ustawienia, podmienione bajty, ścieżka poza snapshotem) oraz kolizja z rekordem zespołu. Każdy przypadek w trybie live i dry run, z porównaniem liczności wszystkich kolekcji, `import-runs` i ustawień przed i po: zero zapisów;
- relacje między rekordami, media, HTML, NFD→NFC, stan `null`, ponowny import `unchanged`, konflikt ustawień;
- ręczna edycja: `preserved`, `manual-edit`, cofnięcie edycji; rezerwacja nie jest edycją; nowy opis i nowy stan ze źródła zachowują ID wierszy i stany; `capacity-below-reserved`;
- topologia wariantów: usunięcie zgłoszone, dodanie zachowuje ID;
- usunięta strona odtworzona; brakujący plik i zmienione bajty zgłoszone bez nowego rekordu media;
- dwa równoległe importy: jeden przechodzi, drugi dostaje odmowę; przejęcie wygasłej dzierżawy;
- wstrzyknięty `SQLITE_BUSY` bez podwójnego liczenia; przerwany przebieg (`failed`) wznowiony bez duplikatów.

Smoke CLI na bazie w `/tmp` (usuniętej po teście): dry run, zrzut zweryfikowany przez `--source-manifest` z nierozwiązanym obrazem (`needs-review`), zrzut czysty (`complete`). Na wyjściu są tylko liczby i rodzaje pozycji, bez ścieżek i treści.

Pełny `tests/*.test.ts` w tym worktree: 72/75. Nie przechodzą `source-ftp.test.ts` i dwa testy `startup.test.ts`, bo w tym drzewie brakuje `scripts/source/`, a `scripts/start.sh` jest starszy niż w roocie. To pliki roota. Importera te testy nie dotyczą, w roocie trzeba je uruchomić po skopiowaniu.

## Ograniczenia

- Kopia klienta i parytet treści: nic nie sprawdzałem. Testy używają wyłącznie syntetycznych danych; prawdziwej paczki, snapshotu ani konwertera nie uruchamiałem.
- GIF, WebP i AVIF Payload przekodowuje przez sharp. Dla nich weryfikuję tylko istnienie pliku i `filesize`, bez skrótu treści. JPEG i PNG mają pełną weryfikację SHA-256.
- Zamiana unikalnych wartości między dwoma rekordami z paczki (A oddaje slug, B go przejmuje w tym samym przebiegu) jest odrzucana jako kolizja. Trzeba ją rozwiązać ręcznie albo w dwóch przebiegach.
- Preflight kolizji działa przed zajęciem blokady. Zmiana w panelu między preflightem a zapisem zatrzyma przebieg na ograniczeniu unikalności Payload (`failed`, wznawialny), bez częściowego rekordu.
- Gdy usunięcie rekordu nadrzędnego wyzeruje relację u dziecka (`ON DELETE SET NULL`), import zgłosi dziecko jako `manual-edit`, bo projekcja się zmieniła. Etykieta jest wtedy myląca.
- Ustawienia nie mają pola pochodzenia. Wartość ustawiona wcześniej przez import, a potem zmieniona w źródle, wygląda jak edycja zespołu i daje `settings-conflict`.
- Dzierżawa zależy od zegara procesu. Opcja `leaseMs` istnieje dla testów, CLI jej nie udostępnia.
- `verifiedSourceManifestHash` dowodzi tylko zgodności paczki z plikiem manifestu, który wskazał operator. Kompletność samego snapshotu (N-11) jest poza importerem.
- Dry run nie sprawdza walidacji hooków Payload ani ograniczeń SQL. Wykrywa je dopiero zapis.
