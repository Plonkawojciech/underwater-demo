# Adapter SQLite w pakietach Next

Rzeczywisty build Next zwracał HTTP 500 z `/api/store/quote`, mimo przejścia wcześniejszych testów usług. Konfiguracja, instrumentation, RSC i route handlers mogą mieć osobne instancje modułu, podczas gdy Payload zachowuje jeden adapter w procesie. Rejestr dzierżaw dla pliku był wspólny, lecz `WeakMap` adapterów i `AsyncLocalStorage` kontekstu transakcji były lokalne.

Prowadzący odtworzył oba problemy testami dwóch rzeczywistych instancji modułu. Przed poprawką oba testy zawiodły: druga kopia nie rozpoznawała adaptera i nie widziała kontekstu blokującego zagnieżdżone BEGIN. Po poprawce rejestr i kontekst są w jednym `globalThis`, współdzielonym z dzierżawami.

Weryfikacja: 36/36 testów integracji i auth (w tym COMMIT z prawdziwym naruszeniem FK, dwa procesy na ostatnią sztukę, reset hasła i liczniki prób), typecheck, clean build oraz pięć rzeczywistych sprawdzeń HTTP. HTTP obejmuje wycenę, zignorowanie ceny podanej przez klienta, zapis i powtórkę zamówienia, dwukrotne anulowanie z przywróceniem zastanego stanu, 301/404 przed streamingiem, izolację hosta, kolekcje prywatne, origin, bootstrap i odrzucenie nieprawidłowego uploadu. Dane są jawnie syntetyczne, płatność testowa, poczta przechwytywana.

Opus 5.5 high przeczytał poprawkę i oba testy. Nie stwierdził blokującej uwagi; nie uruchamiał testów. Prowadzący wykonał opisane przebiegi. Dowód realnego endpointu jest potrzebny obok testu dwóch kopii modułu.

Granice: kontekst ALS zakłada jeden skonfigurowany plik bazy w procesie aplikacji. Zmiana adaptera w dev wymaga restartu istniejącego procesu. Błędy z różnych kopii modułu należy rozpoznawać po stabilnym `code`, jeśli w przyszłości będą mapowane na odpowiedź HTTP. Proxy pozostaje w runtime Node. Limity w lokalnych mapach modułów nie są wspólnym limitem wielu procesów; obecna instancja ma pojedynczy proces aplikacji.
