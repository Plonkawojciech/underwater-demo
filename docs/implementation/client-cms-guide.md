# Panel Underwater: codzienna obsługa treści

Otwórz `/admin` w podglądzie i zaloguj się własnym kontem, które otrzymasz od opiekuna projektu. Podgląd przyjmuje zamówienia i zgłoszenia testowe; nie pobiera pieniędzy ani nie wysyła wiadomości. Testowy status „Opłacone” nie potwierdza wpływu pieniędzy, a „Nadane” nie nadaje przesyłki.

## Kto może wykonać daną czynność

| Rola | Zakres pracy |
|---|---|
| Redaktor treści | Tworzy i edytuje katalog, kursy, terminy, wpisy, wyjazdy oraz media. Publikuje i ukrywa treści. Nie odczytuje prywatnych zamówień, wiadomości ani zgłoszeń na kurs; nie wykonuje korekt magazynu. |
| Obsługa zamówień | Odczytuje zamówienia, wiadomości i zgłoszenia na kurs, a ich statusy zmienia przez „Czynność obsługi”. W katalogu może odczytać produkt i wykonać korektę magazynu, lecz nie edytuje jego opisu ani ceny i nie dodaje treści lub plików. |
| Administrator | Zarządza kontami, rolami i ustawieniami; ma również dostęp do redakcji, obsługi oraz „Historii operacji” i „Skrzynki testowej”. |

Widoczna sekcja katalogu może służyć tylko do odczytu. Jeśli pole pozostaje zablokowane, sprawdź swoją rolę z opiekunem. Każdy pracownik używa własnego konta; historia operacji wskazuje osobę, która wykonała czynność. Redaktor i obsługa nie nadają sobie roli administratora.

Nowa treść zaczyna jako szkic. Zapisuj ją przyciskiem „Zapisz”; aby pokazać ją na stronie, zaznacz „Opublikowane” i zapisz ponownie. Odznaczenie tego pola ukrywa treść bez usuwania. Sama „Data publikacji” nie planuje publikacji na później.

Ceny w polach oznaczonych „zł” wpisuj z najwyżej dwoma miejscami po przecinku, np. `129,90`. Gdy kwota jest błędna, popraw ją w zaznaczonym polu przed zapisem. Przy produktach, kursach i terminach możesz zapisywać również skrótem Ctrl+S lub Cmd+S; Enter w polu nazwy działa jak „Zapisz”. Wyjazd ma osobne pole „Cena w groszach”, opisane poniżej.

## Kategorie sklepu

W „Sklepie” otwórz „Kategorie” → „Stwórz nowy”. Podaj nazwę i nieużywany „Adres (slug)”, np. `nowe-maski`, bez domeny, początkowego ukośnika i `.html`. Strona otrzyma adres `/nowe-maski.html`. „Kategoria nadrzędna” umieszcza ją w istniejącej gałęzi katalogu; puste pole pozostawia ją na najwyższym poziomie. „Kolejność” ustala kolejność wyświetlania.

Zapisz kategorię, zaznacz „Opublikowane” i zapisz ponownie. Następnie wybierz ją w produkcie jako „Kategorię główną”. Pusta opublikowana kategoria pokazuje stronę bez produktów. Odznaczenie „Opublikowane” i zapis ukrywa kategorię, zachowując jej rekord. Przy przeniesionej kategorii zachowaj slug i „ID z VirtueMart”.

## Dodanie produktu

W sekcji „Sklep” otwórz „Produkty”, następnie „Stwórz nowy”. Wpisz nazwę, nieużywany „Numer produktu” oraz „Adres (slug)”, np. `90001-maska-nurkowa`, bez domeny, początkowego ukośnika i `.html`. Produkt będzie dostępny pod `/90001-maska-nurkowa.html`. Przy edycji przeniesionego produktu zachowaj numer i adres.

Wybierz „Kategorię główną”, wpisz „Cenę (zł)” i dodaj zdjęcia. Pierwsze zdjęcie będzie główne. „Krótki opis” pojawia się obok zdjęcia i ceny; „Pełna treść” mieści dłuższy opis. W nowym opisie możesz pisać zwykłym tekstem: pusta linia rozpoczyna kolejny akapit. „Podgląd akapitów” pozwala sprawdzić układ przed zapisem.

„Cena promocyjna (zł)” może zostać pusta. Warianty dodawaj tylko wtedy, gdy klient faktycznie wybiera kolor, rozmiar lub inną opcję. Cenę wariantu również wpisujesz w złotych, np. `129,90`; puste pole pozostawia bieżącą cenę produktu, także promocję. Własna cena wariantu zastępuje tę cenę.

Zapisz produkt przed zmianą magazynu. Administrator i obsługa zamówień używają „Korekty magazynu w podglądzie”: po odczytaniu zapisanego stanu wybierz wariant, wpisz „Nowy potwierdzony stan” i kliknij „Zapisz korektę z audytem”. Po dodaniu lub usunięciu wariantu zapisz produkt i poczekaj, aż korekta pokaże nową listę. Korekta odświeża produkt; przy niezapisanych zmianach pozostaje zablokowana. Zwykły zapis opisu nie zmienia rezerwacji towaru.

Wyświetlany stan oznacza ilość dostępną do kolejnego zamówienia. Złożenie zamówienia testowego odejmuje rezerwację, a anulowanie oczekującego zamówienia ją zwraca. Przy korekcie uwzględnij już zarezerwowany towar; nie dodawaj go ponownie do dostępnej ilości.

Brak potwierdzonego stanu kieruje klienta przez „Zapytaj o dostępność” do formularza kontaktowego. Zgłoszenie trafia do „Kontaktu” wraz z nazwą i adresem produktu; nie tworzy zamówienia i nie rezerwuje towaru. Potwierdzone 0 oznacza brak towaru. Nowy produkt zaczyna ze stanem 0, więc opublikowanie opisu nie włącza zakupu. Cena 0 kieruje do zapytania o cenę. Wpisuj ilości dopiero po ich potwierdzeniu.

Po zaznaczeniu „Opublikowane” i zapisie otwórz adres produktu, sprawdź zdjęcie, cenę oraz opis. Kategoria też musi być opublikowana, żeby produkt można było znaleźć na jej liście.

## Kurs i jego termin

W „Szkoleniach” otwórz „Kursy nurkowania” → „Stwórz nowy”. Podaj nazwę i adres, np. `padi-open-water-diver`. Strona kursu otrzyma adres `/kursy-nurkowania/padi-open-water-diver.html`. Wybierz federację i poziom; głębokość uprawnień oraz minimalny wiek wpisuj zgodnie z programem kursu.

Dodaj zajawkę, opis i zdjęcie główne. Cenę kursu możesz zostawić pustą, jeśli wymaga uzgodnienia. Gdy „Pełna treść” pozostaje pusta, możesz ułożyć „Opis w sekcjach”, dodając nagłówek i tekst każdej sekcji. Strona pokazuje pełną treść albo sekcje. Nie łączy obu opisów. Zapisz i opublikuj kurs.

Konkretną datę dodaj osobno w „Terminach kursów”. Wpisz „Nazwę terminu”, wybierz zapisany kurs, ustal dzień i godzinę „Początku”, ewentualnie „Końca” oraz miejsce. Datę możesz wybrać w kalendarzu lub wpisać, np. `15.11.2026 10:00`. Godzinę wpisuj w formacie 24-godzinnym. „Cena terminu (zł)” zastępuje cenę kursu dla tego terminu; puste pole pozostawia cenę kursu jako cenę główną.

„Potwierdzony limit miejsc” wypełnij tylko znaną liczbą. Puste pole zbiera zgłoszenia bez deklarowania wolnych miejsc. „Zarezerwowane miejsca” uzupełniają zgłoszenia; nie edytujesz tego licznika ręcznie ani nie zmniejszasz limitu poniżej tej liczby. Zaznacz „Opublikowane” i zapisz. Przyszły termin pojawi się na stronie opublikowanego kursu i w kalendarzu; sprawdź tam godzinę pokazywaną w czasie Warszawy.

## Aktualność lub relacja

W „Treściach” otwórz „Strony i aktualności” → „Stwórz nowy”. Wpisz tytuł i „Adres strony”, np. `/aktualnosci/nowy-kurs.html`; tym razem potrzebny jest początkowy ukośnik i pełna końcówka adresu. Nie używaj adresu samej sekcji, np. `/aktualnosci.html`.

Wybierz „Rodzaj”: „Aktualność” pojawi się w aktualnościach, „Relacja” w relacjach, a „Strona informacyjna” pod własnym adresem. Dodaj wprowadzenie, pełną treść oraz zdjęcie. Wpisz „Datę publikacji”, jeśli ma pojawić się przy wpisie i ustalać kolejność w archiwum. „Listę produktów” pozostaw wyłączoną przy zwykłym wpisie. Zapisz, zaznacz „Opublikowane” i sprawdź stronę oraz archiwum.

## Zdjęcie

W „Treściach” otwórz „Media” → „Stwórz nowy” i wybierz zdjęcie z komputera. Obsługiwane formaty to JPEG, PNG, WebP, GIF i AVIF, do 12 MB.

W „Opisie zdjęcia (alt)” opisz, co widać, np. „Maska Sopras Corona, kolor czarny”. Zapisz plik, a następnie wybierz go w polu „Zdjęcia” produktu, „Zdjęcie główne” kursu albo „Zdjęcie” wpisu lub wyjazdu. Przycisk „Wybierz z istniejących” otwiera zapisane media; wybierz właściwy plik i zapisz edytowaną treść. Samo dodanie do Mediów nie wstawia zdjęcia na stronę. Możesz też dodać nowy plik bezpośrednio z pola wyboru zdjęcia.

## Wyjazd

W „Treściach” otwórz „Wyjazdy” → „Stwórz nowy”. Wpisz „Nazwę” i pełny „Adres strony”, np. `/wyprawy/nowy-wyjazd.html`. Dodaj miejsce, wprowadzenie, pełną treść oraz zdjęcie. Pole „Cena w groszach” przyjmuje liczbę całkowitą: dla `129,90 zł` wpisz `12990`. Puste pole pozostawia cenę do uzgodnienia.

„Początek” i „Koniec” dotyczą rzeczywistych dat wyjazdu. Jeśli daty nie potwierdzono, pozostaw ją pustą. Opublikowany wyjazd bez daty trafia do zakładki „Bez podanej daty” na `/wyprawy-nurkowe.html`; nie pojawia się jako najbliższy termin. Datowane wyjazdy trafiają do „Najbliższych” lub „Minionych” zgodnie z datą.

Zapisz szkic, zaznacz „Opublikowane” i zapisz. Otwórz jego stronę oraz odpowiednią listę wypraw. Przycisk „Napisz do nas” przekazuje formularzowi nazwę wyjazdu. To zapytanie o szczegóły i miejsca, bez automatycznego zakupu lub potwierdzenia udziału; wiadomość odczytasz w „Operacjach” → „Kontakt”.

## Wiadomości i zgłoszenia na kurs

Obsługa zamówień i administrator odczytują wiadomości w „Operacjach” → „Kontakt”, a zapisy w „Szkoleniach” → „Zgłoszenia na kursy”. Przy pytaniu o produkt lub wyjazd sprawdź także wskazany temat. Otwórz rekord, wybierz „Czynność obsługi”, potem kliknij „Zapisz status”.

W wiadomościach dostępne są „Skontaktowano” i „Zamknięta”. Status „Skontaktowano” zapisuj po faktycznym kontakcie; jego zmiana sama nie wysyła odpowiedzi. Zgłoszenie kursowe udostępnia „Skontaktowano”, „Zapisany” oraz „Odrzuć i zwolnij miejsce”. Odrzucenie zwalnia rezerwację miejsca; ponowne odrzucenie nie zwalnia kolejnego. Nie poprawiaj ręcznie liczników rezerwacji.

Formularz kursu zbiera zgłoszenie, a potwierdzenie adresu e-mail ma osobny krok. W podglądzie wiadomość z linkiem znajduje się u administratora w „Skrzynce testowej”; odbiorca jej nie dostaje. Uzgodnij udział i warunki z uczestnikiem przed nadaniem statusu „Zapisany”.

## Zamówienia w podglądzie

Otwórz „Sklep” → „Zamówienia”. Sprawdź numer, pozycje, dane zamawiającego, metodę dostawy i płatności oraz oba statusy: „Status” opisuje obsługę, „Płatność” płatność. Dane i ceny zapisane podczas checkoutu pozostają niezmienne, także po późniejszej zmianie katalogu. Status zmieniaj przez „Czynność obsługi” i „Zapisz status”.

| Sytuacja | Dostępna czynność |
|---|---|
| Nowe zamówienie oczekujące na przelew testowy | „Potwierdź wpływ przelewu (symulacja testowa)” zapisuje testowe opłacenie. Podgląd nie podaje rachunku; nie wykonuj przelewu. |
| Zamówienie opłacone testowo | „Oznacz jako wysłane (testowo)” zapisuje status nadania, bez kontaktu z przewoźnikiem. Oczekującego przelewu nie można oznaczyć jako wysłanego. |
| Nowe zamówienie z oczekującą płatnością | „Anuluj i zwolnij rezerwację” zamyka zamówienie i zwraca zarezerwowany towar do dostępnego stanu. Powtórzenie anulowania nie zwiększa stanu ponownie. |
| Zamówienie opłacone lub nadane | Zwykłe anulowanie jest zablokowane. Obsługę zwrotu uzgodnij z administratorem; panel nie wykonuje zwrotu pieniędzy. |

Przy zatwierdzonej konfiguracji pobrania panel udostępnia testowe nadanie przed płatnością oraz „Potwierdź pobranie przy odbiorze (symulacja testowa)” po nadaniu. Widoczność czynności zależy od metody płatności i bieżących statusów. Opiekun musi osobno uzgodnić zasady dostawy i obsługi pobrania.

Po czynności ponownie sprawdź zapisany status. Administrator znajdzie wpis z wykonawcą w „Historii operacji”. „Skrzynka testowa” przechowuje wiadomości bez wysyłki. Wewnętrzna symulacja płatności nie potwierdza integracji z wybranym operatorem, działania rzeczywistych przelewów, pobrania lub zwrotów.

## Gdy coś nie działa

Jeśli treść nie pojawia się na stronie, sprawdź „Opublikowane”, zapis formularza oraz wybrany adres. Przy terminie sprawdź również publikację kursu i to, czy data jest przyszła. Przy zdjęciu sprawdź, czy wybrany plik zapisał się w treści.

Nie zmieniaj „Historycznego adresu” przeniesionego wpisu podczas poprawiania opisu; zachowuje wejścia ze starej strony. Pole „Wyszukiwarki” jest opcjonalne. Bez własnego tytułu i opisu strona używa treści wpisu.

Ręczna poprawka przeniesionej treści może wymagać uzgodnienia przy kolejnym imporcie. Zachowaj poprawkę i przekaż konflikt opiekunowi; nie usuwaj rekordu ani nie twórz duplikatu, aby pozbyć się powiązania ze źródłem. Brakującego starego adresu nie przekierowuj samodzielnie na podobny produkt lub stronę główną. Najpierw opiekun sprawdza właściwy cel i ciągłość adresów.

Gdy panel zgłosi zmianę stanu magazynu, nie nadpisuj go zwykłym zapisem. Zachowaj swoje niezapisane poprawki, odśwież produkt i sprawdź aktualny stan przed korektą. Zleć opiekunowi nadanie odpowiedniej roli, jeśli potrzebnej sekcji nie widzisz w panelu.

Po błędzie połączenia sprawdź zapisany rekord przed ponowieniem korekty lub czynności obsługi. Sama utrata odpowiedzi nie dowodzi, że zapis się nie wykonał.

Kandydat instrukcji z 9.10.2026. Nowe przepływy obsługi czekają na pełne E2E po integracji; [zakres weryfikacji](../orchestration/2026-10-09-underwater_cms_e2e.md) wskazuje wykonane kontrole i pozostały gate. Testy lokalnej bazy syntetycznej nie stanowią odbioru klienta ani potwierdzenia produkcyjnego operatora płatności.
