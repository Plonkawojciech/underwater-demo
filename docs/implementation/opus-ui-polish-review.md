# UI — realizacja i sprawdzenie

Opus 5.5 high przygotował wygląd w osobnym worktree. Prowadzący agent sprawdził diff, dopracował walidację kontekstu formularza, paginację i metadane oraz zintegrował zmiany.

- Nieznany stan produktu wyświetla zdjęcie i zapytanie o dostępność. Nie umożliwia zakupu ani nie udaje zerowego stanu.
- Zapytanie zachowuje rzeczywisty, opublikowany produkt lub wyjazd. Serwer odrzuca podmieniony kontekst.
- Kalendarz łączy wydarzenia, sesje kursów i wyjazdy z datą. Godziny korzystają z Europe/Warsaw.
- Wyjazdy bez dat mają oddzielną listę. Galerie pokazują 48 zdjęć na stronie; osadzone podglądy prowadzą do pełnego albumu.
- Telefon ma osobne odnośniki; banner, menu i formularze działają na małych ekranach.

Dowody rzeczywistej przeglądarki i aktualne wdrożenie należy odczytywać z checkpointu realizacji. Review statyczne nie potwierdza odbioru klienta ani kompletności eksportu źródła.
