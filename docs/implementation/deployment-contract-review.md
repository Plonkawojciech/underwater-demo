# Kontrakt konfiguracji i test wdrożenia

Kontrola HTTPS wykryła rozbieżność niewidoczną w samych testach usług: helper Coolify wybierał `test`, a registry implementowało `internal-test`. Wycena syntetycznego produktu działała, checkout zwracał 500 przed transakcją. Produkt został ukryty; nie wykonano rzeczywistej płatności, wysyłki ani operacji na źródłowej bazie.

Test kontraktu uruchamia rzeczywisty helper konfiguracji z atrapą SSH, potwierdza konkretny własny cel, a następnie uruchamia registry z otrzymanymi zmiennymi. Przed poprawką oba testy nie przeszły. Po poprawce startup i registry korzystają z jednego wyboru adaptera. Nieznana lub pusta wartość przerywa start. Health sprawdza rzeczywisty adapter i podaje jego ID oraz tryb, zamiast deklarować gotowość na podstawie stałego napisu.

`scripts/qa/live-preview.py` ma jeden sztywny własny origin, nie śledzi przekierowań z danymi dostępu i odczytuje zatwierdzone dane Keychain wyłącznie w pamięci. Basic zabezpiecza podgląd, osobne cookie logowania nadaje rolę CMS. Domyślny tryb sprawdza ochronę strony/API/mediów, health, noindex, 404, origin i prywatne kolekcje. `--commerce` tworzy wyraźnie oznaczony produkt TEST, sprawdza cenę serwera, retry checkout, dwukrotne anulowanie i zwolnienie stanu. Po niejednoznacznym wyniku sprawdza unikalny identyfikator zamówienia; nie tworzy drugiego. Niezależne kroki sprzątania zamykają własne otwarte zamówienie i ukrywają oba katalogowe fixtures. Audyt i zamówienie zostają zachowane. Raport nie zawiera tokenów, cookies, haseł ani treści odpowiedzi API.

Opus sprawdził poprawkę, kontrolę zdrowia, helper QA i wcześniejszy import mediów. Prowadzący uwzględnił jego uwagi i uruchomił właściwe testy. Sam review nie jest dowodem przebiegu na VM; wymagane są zakończony deploy konkretnego SHA i rzeczywisty wynik `--commerce` po nim.

## Niezależne procesy testowe

Pełny przebieg ujawnił również zawieszenie pomocniczego procesu podczas ładowania grafu modułów, przed dostępem do bazy. Wcześniejsze ponawianie pustego stdout nie usunęło przyczyny. Fixture jest teraz kompilowany do zwykłego modułu JavaScript, a oba procesy działają w natywnym Node bez loadera tsx. Używamy tej samej przypiętej wersji esbuild, która już występowała w zależnościach tsx; dla tego zastosowania jest jawnie zadeklarowana.

Bariera IPC czeka na gotowość obu instancji Payload. Pierwszy proces rzeczywiście posiada blokadę SQLite, zanim drugi rozpocznie próbę transakcji. Test zwalnia blokadę komunikatem do pierwszego procesu i wymaga dokładnie jednego sukcesu, jednego `InputError` 409, jednego zamówienia i stanu zero. Dowolny błąd 500 nie jest poprawnym odrzuceniem. Nie ma ponawiania procesu. Bootstrap i rodzic mają oddzielne limity czasu, a rodzic czeka na oba zakończenia także po awarii. Natywne timery i skompilowany katalog tymczasowy są sprzątane; pozostawiony uchwyt nie może zawiesić testów bez końca.

## Wcześniejszy import mediów

`prepare_media_checkpoint.py` odczytuje uwierzytelniony checkpoint publicznych zdjęć, sprawdza każdy hash i ścieżkę, a następnie tworzy osobną paczkę bez treści i ustawień, zawsze z `sourceComplete=false`. Istniejącej paczki nie nadpisuje. `verify-media.ts` wykonuje rzeczywisty hook uploadu i pełne dekodowanie każdego obrazu, bez bazy i sieci. Weryfikacja pierwszej paczki objęła 5888/5888 plików. Finalny importer ponownie używa stabilnych kluczy, chroni ręczne edycje i raportuje zmiany bajtów. Aktualność i kompletność całej źródłowej bazy nadal wymagają osobnego eksportu.
