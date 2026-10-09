# Obsługa podglądu Underwater

Podgląd jest prywatny. Zamówienia i płatności są testowe; wiadomości zapisują się w panelu bez wysyłki. Konto administratora podglądu: `underwater-preview@programo.pl`. Hasła przechowuje macOS Keychain, według listy na rano.

## Treści

Produkty, Kategorie, Kursy nurkowania, Terminy kursów, Strony, Wyjazdy, Galerie i Kalendarz mają pole „Opublikowane”. Nowy rekord zaczyna jako szkic. Przed publikacją uzupełnij adres, tytuł i treść; sprawdź wynik na stronie. Redaktor może zmieniać treści, lecz nie pochodzenie importu ani prywatne zgłoszenia i zamówienia. Duplikat zaczyna jako szkic z wyczyszczonym pochodzeniem; nadaj mu własny adres.

Historyczny adres zachowuje wejścia ze starej witryny. Przekierowania służą adresom przeniesionych treści; panel odrzuca pętle i przekierowanie ukrywające istniejącą opublikowaną stronę. Tytuł SEO jest używany dokładnie tak, jak został wpisany.

Zdjęcia dodawaj jako JPEG, PNG, WebP, GIF lub AVIF, do 12 MB. Panel sprawdza rzeczywisty format i rozmiar obrazu. Treść HTML można przenieść ze źródła; aplikacja usuwa skrypty, osadzenia i obce obrazy. Zdjęcia produktu mają przedstawiać rzeczywisty model i producenta.

## Sklep i zgłoszenia

Ceny zapisujemy w złotych i groszach; panel utrzymuje ich zgodność. Wariant ma oddzielny stan i może mieć własną cenę. Puste dane magazynu oznaczają dostępność do potwierdzenia. Produkt z niepotwierdzonym stanem lub ceną nie przechodzi zakupu; strona kieruje do zapytania.

Korektę stanu wykonuj przez „Korekta magazynu w podglądzie”, wpisując potwierdzoną ilość i wybierając „Zapisz korektę z audytem”. Zmiana zapisuje autora oraz wartość przed i po w Historii operacji. Zwykłe zapisanie produktu nie może nadpisać rezerwacji magazynowej. Gdy stan zmienił się w międzyczasie, odśwież produkt i ponów korektę na aktualnych danych.

Oczekujące zamówienie online rezerwuje towar na 30 minut; przelew i pobranie mają czas ustawiony w panelu. Anulowanie, błąd lub wygaśnięcie zwalnia go jednokrotnie. Duplikat powiadomienia nie rezerwuje ponownie. Spóźniona płatność po zamknięciu trafia do sprawdzenia przez obsługę. W podglądzie żaden status nie oznacza rzeczywistego pobrania pieniędzy ani nadania przesyłki.

Zgłoszenie kursowe wymaga potwierdzenia adresu e-mail. Link znajdziesz w „Skrzynce testowej”. Potwierdzenie adresu nie zastępuje akceptacji zgłoszenia przez obsługę. Terminy bez potwierdzonego limitu zbierają zgłoszenia bez deklarowania liczby wolnych miejsc. Odrzucenie lub wygaśnięcie niepotwierdzonego zgłoszenia zwalnia przydzielone miejsce jednokrotnie.

Kontakt ma status obsługi. Newsletter wymaga potwierdzenia i pozwala wypisać się przez osobny link. Linki też trafiają tylko do skrzynki testowej. Obsługa zamówień ma dostęp do tych rekordów, redaktor treści nie.

## Ustawienia i import

Administrator uzupełnia dane kontaktowe, nagłówek, obraz główny i metody dostawy. Niepotwierdzone opłaty pozostaw wyłączone. Domyślna metoda jest jawnie testowa, bez realizacji wysyłki.

Importy pokazują wynik uzgodnienia i historię prób. Publiczny crawl pozostaje oznaczony jako niepełne źródło bazy. Ponowny import chroni ręczne poprawki i bieżące stany; konflikty wymagają uzgodnienia, nie resetu rekordów. Nie kasuj rekordów ani mediów w celu usunięcia konfliktu.

Przyszłe uruchomienie operatora, prawdziwej poczty, analityki i migracja do klienta wymagają odpowiednich danych i osobnego etapu. Obecny runtime dopuszcza wyłącznie podgląd/test/build.

## PDF i zapytania o ofertę

Publiczne materiały do pobrania mają oddzielną kolekcję „Dokumenty PDF”. Maksimum to 8 MB i 1000 stron; parser odrzuca szyfrowanie, aktywne akcje, załączniki oraz niejednoznaczne definicje obiektów. Na VM pracuje osobny proces bez sekretów aplikacji, z limitem całej pamięci adresowej i czasu. Importowane bajty są niezmienne: można poprawić tytuł, ale nowy plik wymaga nowego dokumentu. Źródłowe adresy PDF pozostają aktywne przez własną kopię.

„Zapytaj o produkt” i „Zapytaj o wyprawę” przekazują do kontaktu kontekst potwierdzony na serwerze: opublikowany rekord, jego tytuł i adres. Wiadomość pojawia się w panelu i skrzynce testowej. Wyszukiwarka normalizuje polskie wielkie litery oraz SKU.

## Płatności offline i dostawa

Płatność online rezerwuje towar na 30 minut. Przelew i pobranie zaczynają wyłączone; administrator włącza je w „Płatnościach testowych” wraz z jawnym czasem rezerwacji od 60 do 20160 minut. Podgląd nie podaje rachunku ani nie przyjmuje pieniędzy. W panelu zalogowana obsługa może potwierdzić symulowany wpływ przelewu; klient z linkiem może tylko anulować oczekujące zamówienie.

Metoda dostawy ma rodzaj: kurier wymaga adresu, punkt odbioru wymaga ręcznie wpisanego kodu, nazwy i adresu, odbiór osobisty nie wymaga adresu. Wpisany punkt nie stanowi potwierdzenia przez przewoźnika. Cenę, możliwość pobrania, dopłatę oraz próg bezpłatnej dostawy ustawia administrator. Serwer oblicza grosze i zapisuje wybraną konfigurację z zamówieniem.

Przelew trzeba potwierdzić przed testowym nadaniem. Pobranie można potwierdzić dopiero po testowym nadaniu COD. Nadane zamówienie nie wygasa ani nie zwalnia towaru przez anulowanie. Każda czynność obsługi zapisuje autora w Historii operacji. Zwrot po nadaniu, odmowa przyjęcia, zwrot pieniędzy i wysyłka częściowa wymagają osobnej procedury uzgodnionej z docelowym operatorem oraz przewoźnikiem.

## Przygotowanie płatności online

Po przyjęciu zamówienia klient otwiera prywatną stronę jego statusu. Jeśli operator nie potwierdził przygotowania płatności, zamówienie i rezerwacja pozostają zapisane. „Ponów przygotowanie płatności” wznawia tę samą próbę; nie tworzy kolejnego zamówienia i nie rezerwuje towaru ponownie.

Płatność oznaczona do sprawdzenia pokazuje komunikat o kontakcie ze sklepem. Klient nie może jej samodzielnie ponawiać ani symulować. Późne potwierdzenie po wygaśnięciu wymaga kontroli obsługi i nie otwiera ponownie zamówienia. Stan potwierdza serwer, a nie kliknięcie linku lub powrót od operatora.

Obecny operator `internal-test` symuluje wynik bez sieci i pobrania pieniędzy. W przyszłym sandboxie przycisk na stronie statusu może prowadzić do zweryfikowanego adresu operatora. Prywatny token zamówienia nie trafia do operatora. Wybór operatora i rzeczywista weryfikacja jego sandboxu nadal wymagają danych dostępowych.

## Prywatność i wyszukiwarki

Przy pierwszej wizycie można wybrać tylko niezbędny zapis lub test pomiaru. Ustawienia można otworzyć i zmienić w stopce. Pomiar podglądu liczy wizyty wyłącznie w pamięci bieżącej karty, bez żądań do usług analitycznych. Wycofanie zgody czyści te dane. Treści regulaminu i polityki prywatności publikuje się w CMS po zatwierdzeniu przez klienta.

Mapa `/sitemap.xml` obejmuje opublikowane adresy kanoniczne i pozostaje prywatna, tak jak podgląd. Szczegóły kursów zawierają dane `Course` dla wyszukiwarek; aplikacja nie dodaje niepotwierdzonych ocen, uprawnień ani cen.

## Listy produktów ze starego sklepu

Strona z zaznaczoną „Listą produktów” pokazuje wskazane produkty w kolejności z panelu. Pobiera ich bieżące ceny i widoczność z katalogu. Nieopublikowany produkt nie pojawia się na liście. „Pozycje bez produktu w sklepie” przechowują nazwy modeli wymagających uzgodnienia ze źródłem; strona pozwala zapytać o ich dostępność, bez deklarowania stanu.

Kategoria listy i „Inne strony wyników” służą nawigacji. Pola „Wyniki od”, „Wyniki do” i „Wyników łącznie” zapisują zakres historycznej strony źródłowej; nie stanowią bieżącego licznika katalogu. Przed zmianą tych relacji sprawdź opublikowany widok oraz linki.
