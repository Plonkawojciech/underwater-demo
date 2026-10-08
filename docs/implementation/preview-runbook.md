# Prywatna instancja Underwater

Środowisko realizacji działa wyłącznie na własnej VM Programo przez Coolify. Baza i pliki klienta są źródłem do odczytu. Finalne przełączenie klienta, jego domeny, płatności, poczty i dostaw jest oddzielnym etapem.

## Zasoby i sekrety

Aplikacja Coolify: `qpf9uvw5p9hky4sn5vamun36`, identyfikator 15, branch `main`. Kanoniczny adres: `https://underwater-demo.programo.pl`; drugi własny host przekierowuje do niego. Volume aplikacji: `qpf9uvw5p9hky4sn5vamun36-underwater-data`, montowany jako `/data`.

Nowa baza: `/data/preview/underwater-preview.db`. Media: `/data/preview/media`. Stare `/data/payload.db` i `/data/media` pozostają zachowane. Proces aplikacji działa jako UID 1000. Prywatne archiwa źródła są poza aplikacją, obrazem i katalogiem publicznym.

Runtime wymaga `UNDERWATER_ENVIRONMENT=preview`, `UNDERWATER_DATA_ROOT=/data/preview`, odpowiednich `DATABASE_URI` i `MEDIA_DIR`, kanonicznych `UNDERWATER_ORIGIN`/`NEXT_PUBLIC_SERVER_URL`, `PAYLOAD_SECRET`, `UNDERWATER_PREVIEW_USER`, `UNDERWATER_PREVIEW_PASSWORD`, `UNDERWATER_ADMIN_EMAIL` oraz `UNDERWATER_PAYMENT_PROVIDER=test`. Wartości sekretów pozostają w Pęku kluczy i runtime Coolify; nie w repo, argumentach, logach ani plikach `.env`. Hasło administratora służy tylko do jednorazowego bootstrapu przez stdin.

## Wdrożenie

1. Sprawdzić stan Git, diff, uprawnienia, migracje, typecheck, testy i clean build. Opus sprawdza implementację prowadzącego, prowadzący sprawdza implementację Opusa. Osobno zweryfikować paczkę importu.
2. Commitować wyłącznie własne pliki, przeskanować indeks pod kątem rzeczywistych sekretów i wypchnąć konkretny commit. Korespondencja, prywatny plan, checkpoint, surowe źródło i dane osobowe nie trafiają do publicznego repozytorium.
3. `python3 scripts/deploy/deploy-preview.py queue <40-znakowy-SHA>` wysyła pojedynczą kolejkę wyłącznie tej aplikacji. Zachować identyfikator wdrożenia. `status <deployment-id>` sprawdza wynik. Po niejednoznacznej odpowiedzi sprawdzić ten identyfikator, nie ponawiać kolejki w ciemno ani nie wymuszać pominięcia innych wdrożeń.
4. Potwierdzić rzeczywisty obraz `qpf9uvw5p9hky4sn5vamun36:<SHA>`, właściwy mount i healthy. Start uruchamia wyłącznie addytywne migracje i odmawia uruchomienia po błędzie, bez resetu bazy lub seeda.
5. `scripts/deploy/runtime-preview.py bootstrap <SHA>` tworzy pierwszego administratora przez stdin. Jeżeli polecenie nie zwróci potwierdzenia, sprawdzić `counts <SHA>` i istniejącego administratora przed jakąkolwiek powtórką. Nie nadpisuje istniejącego konta.

## Import

Paczki `priority` i `public` umieścić w `/data/preview/staging/<nazwa>/bundle.json` oraz `media/`, poza publicznym katalogiem mediów. Ustawić prywatne uprawnienia i UID 1000. Nie kopiować konfiguracji PHP, kluczy archiwum ani danych dostępowych źródła.

Najpierw `runtime-preview.py dry-run <SHA> --bundle <nazwa>`, potem `import`. Skrypt sprawdza obraz, volume i wszystkie ścieżki runtime. Importer weryfikuje strukturę, adresy, relacje, SHA i rzeczywisty typ mediów przed zapisem. Raportuje konflikty oraz chroni ręczne edycje, stany i rezerwacje. Drugi import musi być idempotentny; brakujące media i rekordy mają jawny status. Publiczny crawl zawsze pozostaje częściowym źródłem, nawet przy wyczerpaniu kolejki URL. Dopiero zweryfikowany eksport źródłowej bazy może zamknąć uzgodnienie danych.

## Odbiór

Sprawdzić prywatny dostęp strony, API, panelu i mediów, noindex/no-store, canonical, 301/404, pełną paginację oraz reprezentatywne szablony. Formularze, magazyn, kursy, newsletter i płatność testową weryfikować na jawnych danych testowych. Kwoty, podpisy i idempotencja mają osobne testy. Poczta jest przechwytywana w skrzynce dostępnej tylko administratorowi; adapter testowy nie stanowi dowodu działania sandboxu przyszłego operatora.

Wykonać szyfrowany backup nowej bazy i mediów oraz restore do nowego katalogu. Porównać integralność, liczby i hashe. Po restarcie sprawdzić zachowanie danych i ustawienia WAL/busy timeout/FULL/FK. Backup starego demo jest dowodem zachowania wcześniejszych danych; nie zastępuje backupu nowego importu.

Po pracy zachować raporty, klony wymagane do odbioru i archiwa, zakończyć własne procesy i zamknąć własne karty. Pozostawić tylko potrzebny ekran logowania lub niezapisany formularz i wskazać go w raporcie. Nie usuwać cudzych worktree, plików ani procesów.

## Powrót po awarii

Nie cofać addytywnych migracji poleceniem `down` i nie publikować dawnego demo bez prywatnego dostępu. Najpierw zachować aktualną bazę/media oraz logi, ustalić SHA i przyczynę. Restore zawsze do nowego klonu; podmiana działającego katalogu wymaga osobnej decyzji i ochrony nowszych danych. Baza produkcyjna klienta pozostaje poza tym przebiegiem.
