# Panel Underwater: codzienna obsługa treści

Otwórz `/admin` w podglądzie i zaloguj się kontem, które otrzymasz od opiekuna projektu. Panel pokazuje tylko sekcje dostępne dla Twojej roli. Podgląd przyjmuje zamówienia i zgłoszenia testowe; nie pobiera pieniędzy ani nie wysyła wiadomości.

Nowa treść zaczyna jako szkic. Zapisuj ją przyciskiem „Zapisz”; aby pokazać ją na stronie, zaznacz „Opublikowane” i zapisz ponownie. Odznaczenie tego pola ukrywa treść bez usuwania. Sama „Data publikacji” nie planuje publikacji na później.

Ceny wpisuj z najwyżej dwoma miejscami po przecinku, np. `129,90`. Gdy kwota jest błędna, popraw ją w zaznaczonym polu przed zapisem. Przy produktach, kursach i terminach możesz zapisywać również skrótem Ctrl+S lub Cmd+S; Enter w polu nazwy działa jak „Zapisz”.

## Dodanie produktu

W sekcji „Sklep” otwórz „Produkty”, następnie „Stwórz nowy”. Wpisz nazwę, nieużywany „Numer produktu” oraz „Adres (slug)”, np. `90001-maska-nurkowa`, bez domeny, początkowego ukośnika i `.html`. Produkt będzie dostępny pod `/90001-maska-nurkowa.html`. Przy edycji przeniesionego produktu zachowaj numer i adres.

Wybierz „Kategorię główną”, wpisz „Cenę (zł)” i dodaj zdjęcia. Pierwsze zdjęcie będzie główne. „Krótki opis” pojawia się obok zdjęcia i ceny; „Pełna treść” mieści dłuższy opis. W nowym opisie możesz pisać zwykłym tekstem: pusta linia rozpoczyna kolejny akapit. „Podgląd akapitów” pozwala sprawdzić układ przed zapisem.

„Cena promocyjna (zł)” może zostać pusta. Warianty dodawaj tylko wtedy, gdy klient faktycznie wybiera kolor, rozmiar lub inną opcję. Cenę wariantu również wpisujesz w złotych, np. `129,90`; puste pole pozostawia bieżącą cenę produktu, także promocję. Własna cena wariantu zastępuje tę cenę.

Zapisz produkt przed zmianą magazynu. Jeśli Twoja rola pozwala na obsługę stanu, użyj „Korekty magazynu w podglądzie”: po odczytaniu zapisanego stanu wybierz wariant, wpisz „Nowy potwierdzony stan” i kliknij „Zapisz korektę z audytem”. Po dodaniu lub usunięciu wariantu zapisz produkt i poczekaj, aż korekta pokaże nową listę. Korekta odświeża produkt; przy niezapisanych zmianach pozostaje zablokowana. Zwykły zapis opisu nie zmienia rezerwacji towaru. Cena 0 kieruje klienta do zapytania o cenę; brak potwierdzonego stanu nie obiecuje dostępności.

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

W „Opisie zdjęcia (alt)” opisz, co widać, np. „Maska Sopras Corona, kolor czarny”. Zapisz plik, a następnie wybierz go w polu „Zdjęcia” produktu, „Zdjęcie główne” kursu albo „Zdjęcie” wpisu. Samo dodanie do Mediów nie wstawia zdjęcia na stronę. Możesz też dodać nowy plik bezpośrednio z pola wyboru zdjęcia w edytowanej treści.

## Gdy coś nie działa

Jeśli treść nie pojawia się na stronie, sprawdź „Opublikowane”, zapis formularza oraz wybrany adres. Przy terminie sprawdź również publikację kursu i to, czy data jest przyszła. Przy zdjęciu sprawdź, czy wybrany plik zapisał się w treści.

Nie zmieniaj „Historycznego adresu” przeniesionego wpisu podczas poprawiania opisu; zachowuje wejścia ze starej strony. Pole „Wyszukiwarki” jest opcjonalne. Bez własnego tytułu i opisu strona używa treści wpisu.

Gdy panel zgłosi zmianę stanu magazynu, nie nadpisuj go zwykłym zapisem. Zachowaj swoje niezapisane poprawki, odśwież produkt i sprawdź aktualny stan przed korektą. Zleć opiekunowi nadanie odpowiedniej roli, jeśli potrzebnej sekcji nie widzisz w panelu.
