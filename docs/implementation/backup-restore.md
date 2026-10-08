# Szyfrowany backup i weryfikowany restore

Skrypt: `scripts/backup/underwater_backup.py`. Testy: `tests/backup.test.ts`.

Narzędzie obejmuje tylko naszą izolowaną instancję: `<data-root>/underwater-{preview|test}.db` i `<data-root>/media`. Nie zna bazy ani plików źródłowej Joomli i nie przyjmuje do nich danych dostępowych. Inne pliki z `data-root` (`.env`, `-wal`, `-shm`, logi) nie trafiają do archiwum.

## Wymagania

- Python 3 z pakietem `cryptography` (testowane lokalnie na 50.0.2; kod używa wyłącznie strumieniowego `Cipher(AES, GCM)`, dostępnego także w 43 na VM).
- Klucz: 32 losowe bajty, przekazywane wyłącznie na stdin jako JSON `{"key": "<base64>"}`. Skrypt nie czyta klucza z argumentów, plików ani zmiennych środowiska i nigdy go nie wypisuje. Klucz trzymamy w Keychain lub sekretach VM.

## Użycie

```sh
# backup: katalog docelowy musi nie istnieć albo być pusty
key_json | python3 scripts/backup/underwater_backup.py backup \
  --data-root /data --environment preview --destination /backups/underwater/2026-10-08

# restore: zawsze do nowego, pustego katalogu (klon), nigdy na działającą bazę
key_json | python3 scripts/backup/underwater_backup.py restore \
  --archive /backups/underwater/2026-10-08/underwater-preview-20261008T120000Z.uwbak \
  --destination /restore-check/2026-10-08
```

`key_json` to dowolne polecenie wypisujące JSON z kluczem na stdout (np. odczyt z Keychain), bez zapisu na dysk i w historii powłoki.

Opcje: `--min-free-bytes` (rezerwa dysku, domyślnie 1 GiB), przy restore także `--max-total-bytes` (16 GiB), `--max-file-bytes` (4 GiB) i `--max-members` (200 000).

Wynik: jedna linia JSON na stdout z liczbami (tabele, wiersze, pliki mediów, bajty), wynikiem `integrity_check`, ostatnią migracją Payload i SHA-256 archiwum. Bez treści rekordów. Kody wyjścia: `0` sukces, `2` odmowa z powodu reguły bezpieczeństwa, `1` nieoczekiwany błąd.

## Format archiwum

```
MAGIC "UWBAK\0\1\n" | u32 długość nagłówka | nagłówek JSON | szyfrogram AES-256-GCM | tag 16 B
```

Nagłówek (format, wersja, środowisko, czas, nonce) jest jawny, ale uwierzytelniony jako associated data GCM. Pod szyfrem jest strumień tar: snapshot bazy, pliki mediów i na końcu `MANIFEST.json` z rozmiarem i SHA-256 każdego pliku, środowiskiem, czasem, wersją narzędzia, wersją SQLite, trybem dziennika źródła i ostatnią migracją. Jeden nonce na archiwum; limit 32 GiB tekstu jawnego (GCM dopuszcza ok. 64 GiB na nonce).

## Backup krok po kroku

1. Ścieżki muszą być bezwzględne, znormalizowane i bez symlinków w żadnym segmencie. `--destination` nie może leżeć w `data-root` ani go zawierać.
2. Baza i katalog mediów muszą być zwykłym plikiem i katalogiem. Media są skanowane bez podążania za linkami. Symlink, hardlink, plik specjalny, nazwa spoza UTF-8 lub ze znakami sterującymi, plik `.env*` albo kolizja nazw różniących się wielkością liter kończą backup odmową.
3. Sprawdzenie wolnego miejsca: dwukrotność danych plus narzut tar plus rezerwa.
4. Snapshot bazy przez SQLite online backup API z połączenia `mode=ro`. Obejmuje zatwierdzone transakcje z WAL. Kopia ma tryb `DELETE` (jeden plik) i przechodzi `integrity_check`. Leży w prywatnym `.work-*` w katalogu docelowym i jest usuwana po zakończeniu.
5. Każdy plik mediów jest otwierany z `O_NOFOLLOW`, a jego tożsamość (urządzenie, inode, rozmiar, mtime, ctime) porównywana przed, po i z ponownym `lstat`. Po skopiowaniu wszystkiego media są skanowane ponownie. Każda różnica oznacza odmowę.
6. Archiwum powstaje jako `.<nazwa>.partial` (0600, `O_EXCL`), po `fsync` dostaje docelową nazwę. Katalog docelowy ma 0700. Przy błędzie znikają tylko pliki utworzone przez ten przebieg (i katalog, jeśli go utworzył).

Starsze backupy zostają nietknięte, bo każdy przebieg pisze do nowego katalogu. Rotacja nie jest częścią narzędzia.

## Restore krok po kroku

1. `--archive` musi być zwykłym plikiem bez symlinków w ścieżce. `--destination` nie może istnieć albo musi być pustym katalogiem.
2. Odczyt i walidacja nagłówka, limity rozmiaru, sprawdzenie wolnego miejsca.
3. Prywatny katalog roboczy obok celu (`.<nazwa>.restore-*`, 0700). Cały szyfrogram jest odszyfrowywany do `authenticated.tar` (0600). Dopiero gdy tag GCM się zgadza, cokolwiek z tar jest czytane. Zły klucz, zmieniony bajt szyfrogramu, zmieniony nagłówek lub obcięty plik dają odmowę przed rozpakowaniem.
4. Pierwszy przebieg po nagłówkach tar: dozwolone są tylko zwykłe pliki o nazwach `underwater-{env}.db`, `media/...` i `MANIFEST.json` (ostatni). Odmowa przy symlinkach, hardlinkach, katalogach, plikach specjalnych, ścieżkach bezwzględnych, `..`, duplikatach (także różniących się wielkością liter lub normalizacją Unicode), przekroczeniu limitów oraz gdy lista plików różni się od manifestu w którąkolwiek stronę. Manifest musi zgadzać się z nagłówkiem.
5. Drugi przebieg zapisuje pliki do `clone/` (`O_EXCL | O_NOFOLLOW`, pliki 0600, katalogi 0700, bez bitów wykonywania) i porównuje rozmiar oraz SHA-256 z manifestem.
6. `integrity_check` na klonie (`mode=ro&immutable=1`), potem `rename` klonu na `--destination`. Katalog roboczy jest zawsze usuwany. Przy błędzie archiwum i istniejący pusty cel zostają bez zmian.

Przywrócona baza jest w trybie `DELETE`; aplikacja przy starcie przełącza ją na WAL (`wal` w `payload.config.ts`). Pole `source_journal_mode` w raporcie mówi, jaki tryb miało źródło.

## Testy

`pnpm exec tsx --test tests/backup.test.ts` (wchodzi też w `pnpm test`). Testy używają tylko syntetycznych danych w katalogach tymczasowych i losowego klucza na stdin. Interpreter: `UNDERWATER_BACKUP_PYTHON`, potem runtime Codexa, potem `python3`; bez `cryptography` testy są pomijane z komunikatem.

Pokryte: wiersze obecne tylko w WAL otwartego połączenia trafiają do klonu, media są identyczne bajt w bajt, `.env` nie trafia do archiwum, uprawnienia 0700/0600, zmieniony szyfrogram, nagłówek, obcięcie i zły klucz nie tworzą celu, dwanaście rodzajów niebezpiecznych lub niezgodnych archiwów (podpisanych prawidłowym kluczem) jest odrzucanych, istniejąca treść w celu backupu lub restore nie jest ruszana, symlink i `.env*` w mediach, ścieżki względne, z `..` i przez symlink, zły format klucza i brak rezerwy dysku kończą się odmową bez katalogu docelowego.

## Ograniczenia

- Odczyt zamkniętej bazy w trybie WAL połączeniem `mode=ro` zostawia w `data-root` puste pliki `-wal` i `-shm`. To normalne pliki SQLite; aplikacja i tak je tworzy.
- Snapshot bazy i kopia mediów nie są jedną atomową operacją. Wykrywana jest każda zmiana mediów między pierwszym skanem a końcem kopiowania, ale upload w tym oknie oznacza odmowę i trzeba powtórzyć backup.
- Wykrywanie zmiany pliku w trakcie kopiowania nie ma testu automatycznego (wymagałoby wstrzyknięcia opóźnienia); jest pokryte przeglądem kodu.
- Python nie pozwala niezawodnie wyzerować klucza w pamięci procesu.
- `rename` na pusty katalog docelowy zastępuje go (POSIX). Jeśli w tym czasie ktoś coś w nim zapisze, `rename` się nie powiedzie i nic nie zostanie nadpisane.
- Brak rotacji, wysyłki poza VM i harmonogramu; to decyzja operatora.
