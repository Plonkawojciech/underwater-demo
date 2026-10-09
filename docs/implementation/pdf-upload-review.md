# Weryfikacja publicznych PDF

Pliki PDF mają oddzielną kolekcję i katalog. Hook wymaga pliku, sprawdza rolę przed dekodowaniem, odrzuca zdalny adres w JSON i chroni bajty importowanych oryginałów przed podmianą. Publiczna odpowiedź wymusza pobranie, `nosniff`, `no-store` oraz CSP z `sandbox`.

Parser działa w osobnym procesie bez sekretów aplikacji. Limity: 8 MB pliku, 1000 stron, 128 MB sterty, na Linuxie 1 GiB całej przestrzeni adresowej i 15 sekund. Kolejka ma jeden aktywny proces i osiem miejsc oczekujących; timeout kończy proces i czeka na jego zamknięcie.

Przeglądy Opusa wskazały różnice między wyborem obiektów przez parser a czytnik PDF. Prowadzący odtworzył akceptację syntetycznych przykładów przed poprawką i odrzucenie po niej. Walidator sprawdza każdy nagłówek obiektu i końcowy xref, odrzuca powtórzone definicje, szyfrowanie w dowolnym trailerze, nieodczytane strumienie ObjStm/XRef oraz pośrednie selektory `S`, `Subtype`, `URI`. Przegląd nie jest dowodem wykonania kodu w przeglądarce; takiego wykonania nie testowano.

Zaostrzona polityka może odrzucić dokument dopuszczony przez bardziej tolerancyjny czytnik. W takim przypadku zachować oryginał w prywatnej kopii i rozstrzygnąć konflikt, bez automatycznego przepisywania PDF. Wszystkie 38 rzeczywistych publicznych oryginałów klienta, łącznie 42 strony i 18 906 941 bajtów, przeszły końcową walidację na Linuxie bez zmiany bajtów. Najwyższy zmierzony RSS procesu wyniósł 78 577 664 bajty. Testy obejmują także aktywne akcje, załączniki, błędy ścieżek, referencji i skompresowany strumień przekraczający limit pamięci.
