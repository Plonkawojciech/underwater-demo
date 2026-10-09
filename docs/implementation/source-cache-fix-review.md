# Kopia publicznych zdjęć

Dwa źródłowe zdjęcia o różnych sumach kontrolnych dzieliły ścieżkę na systemie plików bez rozróżniania wielkości liter. Weryfikacja pełnego zbioru wykryła błąd przed importem. Klucze źródła, adresy i zaszyfrowane oryginały pozostały niezmienione.

`media_cache.py` zapisuje każde zdjęcie pod `images/<sha256(source-key)>.<rozszerzenie-małymi-literami>`. Weryfikuje sumę kontrolną kopii, a oryginał przesłonięty przez kolizję odzyskuje z uwierzytelnionego archiwum AES-GCM. Zachowuje starsze pliki i obiekty archiwum. Konflikt docelowego pliku, symlink, wyjście poza katalog lub błędne uwierzytelnienie przerywają odtwarzanie.

Odtwarzanie z kopii nie wykonuje żądań do źródła. Manifest zapisuje się po najwyżej 500 odtworzonych plikach; nowo pobrane i zweryfikowane zdjęcia zapisuje od razu. Znane błędy źródła pozostają w raporcie bez ponawiania żądań.

Test syntetyczny sprawdził kolizje nazw i wielkości liter, uwierzytelnienie archiwum, różne sumy kontrolne, konflikty, symlinki, odtwarzanie bez sieci, zachowanie oryginałów i ograniczoną częstotliwość zapisu manifestu. Pełne odtwarzanie z kopii zachowało 14 784 zdjęcia i 37 błędów źródła. Wszystkie 14 784 zdjęcia przeszły lokalną weryfikację bajtów, hooka uploadu i dekodowania obrazu bez bazy i sieci. Opus nie znalazł w poprawce problemu P1/P2. Import na podglądzie oraz uzgodnienie rekordów stanowią oddzielny dowód; kopia publiczna nie dowodzi kompletności bazy klienta.
