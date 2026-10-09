# Underwater: poprawki po niezależnym QA

Zakres: UW-01, UW-03 i UW-04 (P2), następnie UW-02 (P3). Punktem wyjścia jest `d29e84c`; raport testera mierzył podgląd do 15:13 CEST, przed wdrożeniem tej wersji o 15:33 CEST. Odtwarzamy każdy przypadek na aktualnej wersji. Prawdziwego historycznego błędu nie oznaczamy jako fałszywego alarmu tylko dlatego, że został wcześniej naprawiony.

1. Potwierdzić bieżący obraz podglądu i wykonać odczytowy retest na rzeczywistych treściach: 8 szablonów, 360/390/768/1280/1920 px, produkt na wolnej sieci, kontakt z CTA i tabela CMS.
2. W oddzielnych worktree przygotować poprawki oraz regresje: długi tytuł kursu i opóźniony JavaScript; kontakt z długimi biografiami i zachowanym kontekstem zapytania; wartości wyróżnienia true/false/null w CMS.
3. Zintegrować tylko własne zmiany, wykonać typecheck, testy, build, pełny E2E i niezależne review. CI używa wyłącznie syntetycznej bazy.
4. Zachować świeżą kopię własnej bazy przed wdrożeniem. Commit, push i deploy wyłącznie na aplikację Coolify `qpf9uvw5p9hky4sn5vamun36`. Sprawdzić dokładny SHA obrazu, zdrowie aplikacji, dane i media oraz rzeczywisty HTTPS.
5. Dopisać status każdego UW do raportu QA, zachować dowody oraz posprzątać własne procesy, karty i worktree.

Baza i hosting klienta pozostają tylko do odczytu. Ten zakres nie wymaga żadnego dostępu do źródłowej bazy, migracji ani zapisu u klienta. Testy zapisu działają wyłącznie w tymczasowej bazie własnego harnessu. Nie zmieniamy stanów magazynowych, treści biografii ani konfiguracji operatora płatności.
