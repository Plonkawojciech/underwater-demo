# SEO techniczne i mapa adresów do przyszłej migracji

Stan przygotowania: 9 października 2026, własna kopia danych z commita `945d5ac`. Ten pakiet nie zmienia witryny ani bazy klienta i nie uruchamia migracji. Podgląd zachowuje prywatny dostęp, `noindex` i `no-store`.

## Pełna lista dostępnych adresów

Eksport obejmuje 6126 unikalnych URL-i: 6021 udanych zapisów publicznego crawla, 26 nieudanych prób, 35 wyłączonych adresów nawigacji oraz 44 adresy PDF z zachowanych metadanych dokumentów. Nie oznacza to pełnej kopii witryny ani aktualnego zrzutu SQL. Osobno podaje każdą z tych grup, żeby nie ukrywać braków w mianowniku.

Wynik na zachowanej kopii zawiera 5256 adresów `retained200`, 625 `redirect301`, 180 `unresolved404` i 65 `review`. Status w eksporcie wynika ze wspólnego resolvera publicznych treści i reguł proxy; nie zastępuje nowego pomiaru HTTP. `retained200` zachowuje dawny adres bez przekierowania. `redirect301` oznacza istniejącą, opublikowaną regułę, której cel prowadzi do opublikowanej treści. `review` obejmuje też nieudany crawl, wyłączoną nawigację i dawne formularze kont.

Wszystkie 627 opublikowanych rekordów przekierowań przechodzą osobny audyt: jeden krok do osiągalnego adresu kanonicznego, bez pętli, łańcuchów i przykrywania opublikowanej treści. Dwie reguły nie występują w oryginalnej liście crawla. Do eksportu reguł trafiają tylko bezpieczne, względne ścieżki; docelowa domena to `https://www.underwater.pl`, a nie prywatny podgląd Programo.

Reguły 301 są właściwe dla przeniesionych treści, podczas gdy zachowany URL nie wymaga przekierowania do siebie. Google zaleca przekierowanie bezpośrednio do końcowego adresu. [Google Search Central: migracje adresów](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes).

## Brakujące adresy i jedna propozycja

180 adresów nie ma obecnie opublikowanego celu: 87 wiąże się z konfliktem zachowanych treści, 47 z celowo pominiętą nawigacją kalendarza, 17 z pustym komponentem sklepu, 16 z nierozpoznaną kategorią produktu, cztery z niejednoznaczną nazwą, trzy z brakiem ceny, dwa z brakiem tytułu galerii. Pozostałe cztery dotyczą nieprawidłowego pola, braku tytułu strony, błędu źródłowej Joomli i historycznego aliasu strony głównej. Wszystkie mają wpis z powodem; nie kierujemy ich zbiorczo na stronę główną.

Jeden adres ma dokładny dowód zapisanej odpowiedzi źródła: `/category/226-hippocampusbargibanti.html` prowadził do `/strona-glowna/mapa-strony.html`, a ten znany alias ma zweryfikowaną regułę do `/`. Osobny plik propozycji przygotowuje bezpośrednie 301 do `/`; bieżący status pierwszego adresu pozostaje 404 do czasu zastosowania reguły na własnej kopii. Pozostałe 179 wymaga uzgodnienia z aktualnymi rekordami źródłowymi lub świadomej decyzji po ich odczycie. Nie dopisujemy zastępczych celów na podstawie podobieństwa nazw.

Te 180 adresów nie należało do wcześniejszego, domkniętego sprawdzenia 5850 zaimportowanych tras. Raport zachowuje ten historyczny dowód, ale nie rozszerza jego mianownika na cały crawl.

## Eksport i kontrola

`scripts/qa/export-migration-map.ts` działa wyłącznie offline. Przyjmuje prywatną projekcję pól routingu z własnej bazy i listę zapisanych URL-i; nie pobiera źródła, nie loguje się do CMS i nie zapisuje bazy. Pola routingu to `id`, `published`, `slug`, `path`, `legacyPath`, a dla przekierowań `from` i `to`. Z dokumentów korzysta tylko z `id`, `legacyPath` i adresu pliku. Zwykłe liczby 0/1 z odczytu SQLite normalizuje do booleanów.

Pliki wynikowe to pełna lista JSON i CSV, bieżące reguły 301, oddzielne propozycje nowych reguł, audyt wszystkich opublikowanych przekierowań, XML oraz dowód z hashami wejść i wyjść. Eksport nie nadpisuje istniejących plików. W CSV są też adres kanoniczny, docelowy URL, rodzaj rekordu, powód oraz problemy. Przed przyszłym wdrożeniem trzeba ponowić eksport na finalnej kopii i sprawdzić HTTP po zastosowaniu zaakceptowanych reguł.

Sitemap zawiera 5227 osiągalnych, opublikowanych adresów kanonicznych aktualnego podglądu. Korzysta z takiej samej kolejności rozstrzygania kolizji jak strony i nie publikuje nieosiągalnych aliasów, prywatnych ścieżek ani wymyślonych dat `lastmod`. Dzisiejsze dane podglądu zawierają także jawne dane demonstracyjne; przygotowany XML nie jest poleceniem publikacji na produkcji klienta.

## Dane strukturalne i adresy kanoniczne

Product korzysta z bezpiecznego adresu kanonicznego i faktycznych pól katalogu. Każdy wariant o znanej cenie tworzy własny `Offer`, cena w groszach przechodzi do PLN z dwoma miejscami po przecinku, a brak stanu nie publikuje `InStock`. Cena zero pozostaje zapytaniem i nie tworzy oferty darmowego produktu. Google zabrania używania `AggregateOffer` do grupy wariantów. [Google Search Central: Product](https://developers.google.com/search/docs/appearance/structured-data/product-snippet).

Course zachowuje widoczny opis i dostawcę `Underwater.pl`; nie dopisuje ocen, certyfikatów, ceny ani terminów na podstawie domysłu. [Schema.org: Course](https://schema.org/Course).

Organization podaje widoczną nazwę marki, skonfigurowany adres witryny i uzupełnione dane kontaktowe ze stopki. Nie wywodzi nazwy prawnej, NIP, logo, godzin otwarcia czy współrzędnych. Nieprawidłowe adresy i linki zawierające dane logowania pomija. [Google Search Central: Organization](https://developers.google.com/search/docs/appearance/structured-data/organization).

Metadane dopuszczają bezpieczny adres strony i wyłącznie poprawne `?strona=2` do `?strona=1000`. Parametry wyszukiwania, tokeny, ścieżki panelu i kodowane adresy prywatne nie trafiają do canonical ani Open Graph. JSON-LD używa istniejącego kodowania, które uniemożliwia zamknięcie znacznika `script` przez tekst z CMS.

## Weryfikacja

Pakiet ma testy dla pełnego pokrycia listy, dokładnego dopasowania reguł proxy, pierwszeństwa treści, nieopublikowanych rekordów, pętli, łańcuchów, błędnych celów, propozycji odrębnych od istniejących reguł, parametrów prywatnych, schema wariantów oraz danych Organization. W zamrożonym V13 typecheck bez incremental zakończył się kodem 0 w 15,024 s. Oficjalny runner na Node 22.23.3 potwierdził 351/351 PASS w 41 plikach, kod 0 i czas 234,893 s; wszystkie 319 hashów wejściowych oraz typy Payload pozostały niezmienione. Wynik obejmuje testy SEO/Payload należące do V13. Prywatny `native-v13-summary.json` wskazuje pełne logi i manifest. Wcześniejsze 347 PASS V11 oraz 346 PASS V9 pozostają historyczne; negatywny TC V12 przez typowanie fixture testu jest zachowany osobno.

Końcowy eksport `migration-map-final-v2` zachowuje opisane wyżej 6126 adresów oraz osobny audyt 627 przekierowań. Kontrola potwierdziła zgodność wszystkich ośmiu SHA: projekcji routingu, zapisanej listy crawla i sześciu plików wynikowych. Statusy wynikają z analizy offline; eksport wykonał zero nowych żądań do klienta i zero zapisów bazy. Nadal brakuje bieżącego eksportu SQL klienta, a propozycja dodatkowej reguły 301 czeka na zastosowanie.

Wcześniejsza lokalna próba na Macu anulowała pięć przypadków w hooku Payload; jej log pozostaje historycznym dowodem nieudanego przebiegu. Aktualne archiwum V13 zawiera 319 plików o SHA `56a2e6a005a9227f65f8284259101d74614c3f4e38790a56b1634a5dee1a3a70`. Obraz runtime V12 to `sha256:b745cab53ee1c1d7c9752405607d84490b0060b140fc0c1866c5deaff1a58c17`; porównanie V12–V13 wykazało tylko zmianę typowania testu CMS, bez różnicy w źródłach aplikacji. Na tym obrazie rzeczywisty E2E potwierdził 22/22 PASS desktop/mobile, naturalny kod 0 i brak retry, w około 1,7 min. Raport Playwright obejmuje także canonical, noindex i ochronę rekordów, lecz nie zastępuje nowego pełnego crawla HTTP ani dowodu indeksowania u Google.

Review Codexa V11, minimalnej poprawki błędów V12 oraz końcowej różnicy CSS/CI mają `MERGE OK` bez P1/P2 w swoich zakresach. Końcowy Opus 5.5 high zaakceptował źródła i wygląd, zamykając wcześniejsze warunkowe P2 obrazów. Naturalnie zakończony pomiar V12 obejmuje 18 Lighthouse i sześć kontroli funkcjonalnych; 16/18 pojedynczych LCP jest poniżej 2,5 s, a dwa przekroczenia pozostają w raporcie. Macierz 54 widoków i kontrole axe opisuje plan rundy jakości. Te wyniki nie stanowią dowodu terenowego p75 ani pełnej zgodności WCAG.

To checkpoint przed pushem. Rzeczywisty CI i kontrola HTTPS po wdrożeniu pozostają otwarte; bieżący raport realizacji prowadzącego z linkiem CI i tożsamością deploya ma pierwszeństwo po ich zakończeniu. Wcześniejsze nieudane E2E są zachowane. Wyniki V9 pozostają historyczne, a mapa offline nadal nie zastępuje pełnego HTTP crawla lub bieżącego SQL.
