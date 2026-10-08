# Szyfrowana kopia plików źródłowych (VM)

`scripts/source/snapshot_worker.py` kopiuje pliki z zaszyfrowanej inwentaryzacji (`inventory.enc`) przez 1–4 niezależne połączenia FTPS tylko do odczytu. Każdy plik jest szyfrowany w locie; na dysk VM nie trafia żaden plaintext i nic nie jest wykonywane (PHP to dla workera zwykłe bajty). `scripts/source/start_snapshot.py` uruchamia go z Maca.

To kopia plików, nie zrzut bazy: `database_snapshot` jest zawsze `false`.

## Uruchomienie

```sh
python3 scripts/source/start_snapshot.py                  # 4 połączenia
python3 scripts/source/start_snapshot.py --connections 2  # 1..4
```

`start_snapshot.py` kopiuje worker, `ftp_readonly.py` i `inventory.enc` na VM, a potem uruchamia `python3 snapshot_worker.py --connections N` przez SSH. Klucz i hasło z Keychain idą wyłącznie przez stdin (jedna linia JSON `{key, password}` w base64). W argv jest tylko liczba połączeń. Nadmiarowe pola na stdin przerywają start przed jakimkolwiek połączeniem.

Worker trzyma `flock` na `snapshot.lock` w katalogu docelowym, więc drugi równoległy worker kończy się błędem `AlreadyRunning`. Stary worker sekwencyjny tej blokady nie bierze: przed startem nowego trzeba go zatrzymać.

## Model wątków

- Koordynator (wątek główny) czyta inwentaryzację, rozdziela pracę, przyjmuje wyniki i jako jedyny zapisuje manifest.
- Każdy wątek pobierający ma własne połączenie `TrackedFTP` (podklasa `ReadOnlyFTP`, ta sama lista dozwolonych komend). Połączenia nie są współdzielone. Wątek zwraca słownik z wynikiem i nie dotyka manifestu.
- W locie jest najwyżej `2 × connections` zadań. Kolejka zadań jest wypełniana leniwie z posortowanej listy, więc 174 tys. plików nie tworzy 174 tys. obiektów future.
- Dopóki pierwsze logowanie się nie powiedzie, logowania są serializowane. Złe hasło albo certyfikat to jedna próba, nie cztery.

## Formaty

- Inwentaryzacja i manifest: `UWENC1 | nonce(12) | AES-256-GCM(JSON)`, AAD `underwater-source-manifest`. Bajty `inventory.enc` są czytane raz; ten sam bufor jest hashowany (`inventory_sha256`) i odszyfrowany.
- Obiekt pliku: `objects/<sha256(ścieżka)>.enc` = `UWENC2 | nonce(12) | szyfrogram | tag(16)`, losowy nonce na plik, AAD to ścieżka źródłowa. Rekord w manifeście ma `bytes`, `sha256` plaintextu, `source_mdtm`, `inventory_bytes`, `changed_since_inventory`.
- Manifest zapisywany atomowo: plik `.part` z unikalną nazwą przebiegu, `fsync`, `rename`. Uprawnienia `0600`, katalogi `0700`.

Schemat rekordów jest zgodny z manifestem starego workera sekwencyjnego, więc nowy worker wznawia jego pracę.

## Pobranie jednego pliku

`SIZE` i `MDTM` przed transferem, `RETR` z szyfrowaniem strumieniowym, `SIZE` i `MDTM` po. Gdy rozmiary nie zgadzają się z liczbą odebranych bajtów albo `MDTM` się zmienił, próba kończy się `SourceChanged`. Plik ma 3 próby. Po każdej nieudanej próbie połączenie jest zamykane, a własny `.part` usuwany. Po trzech próbach powstaje rekord `{path, complete: false, error_type, attempts: 3, inventory_bytes}`. Kolejny przebieg ponawia takie pliki.

Pliki `.part` mają w nazwie identyfikator przebiegu (`<sha>.<run_id>.part`). Worker usuwa tylko własne; pozostałości po innych przebiegach i po starym workerze (`<sha>.enc.part`) zostają.

## Wznowienie

Rekord `complete` jest przyjmowany dopiero po uwierzytelnieniu szyfrogramu (GCM z AAD ścieżki) i porównaniu `sha256` oraz `inventory_bytes` z bieżącą inwentaryzacją. Istniejący obiekt nigdy nie jest nadpisywany ani kasowany; przed ponownym pobraniem dostaje nową nazwę:

- `<sha>.corrupt-<uuid>.enc`: nie przeszedł weryfikacji,
- `<sha>.superseded-<uuid>.enc`: poprawny, ale inwentaryzacja podaje inny rozmiar,
- `<sha>.unrecorded-<uuid>.enc`: obiekt bez rekordu (po twardym zabiciu procesu między zapisem obiektu a checkpointem).

Manifest, którego nie da się uwierzytelnić, przerywa start przed połączeniem i zostaje na dysku bez zmian.

## Błędy połączenia

| Błąd | Zachowanie |
| --- | --- |
| `530`/`532`, dowolny `error_perm` przy logowaniu | koniec przebiegu, bez ponawiania |
| `SSLCertVerificationError`, `PermissionError` (zmiana adresu, komenda spoza listy) | koniec przebiegu |
| brak miejsca (`ENOSPC`, `EDQUOT`, `EROFS`, `EACCES`) lub rezerwa | koniec przebiegu |
| `421`, reset, timeout, `EOFError` przy łączeniu | 5 prób z rosnącą przerwą; potem wątek odchodzi, a jego zadanie wraca do kolejki |
| wszystkie wątki odeszły | koniec przebiegu, `NoConnections` |

Błąd krytyczny nie jest zapisywany jako błąd pliku. Na wyjściu i w manifeście jest tylko nazwa typu błędu, nigdy jego treść.

Rezerwa miejsca: przed wysłaniem pliku do wątku wolne miejsce minus rozmiary plików w locie musi wynosić co najmniej `max(2 × rozmiar, 5 GB)`.

## Przerwanie

`SIGINT`, `SIGTERM` i `SIGHUP` (zerwane SSH) zatrzymują rozdzielanie pracy. Wątki przerywają transfer przy następnym bloku danych, zamykają swoje połączenie i usuwają własny `.part`. Koordynator czeka na wyniki do 15 s, potem robi `shutdown` gniazd sterującego i danych każdego wiszącego połączenia i czeka jeszcze 5 s. Wątki są daemonami, więc nie przeżyją procesu. Wszystkie wyniki, które dotarły, trafiają do końcowego checkpointu z `stop_reason: "interrupted"`. Przerwany plik nie dostaje rekordu błędu.

Kody wyjścia: `0` przebieg doszedł do końca (także z błędami plików; patrz `complete_snapshot`), `1` błąd krytyczny, `128 + sygnał` przerwanie (`130`, `143`, `129`), `2` złe argumenty.

## Postęp i checkpoint

Postęp (liczniki, bez ścieżek) co 100 przetworzonych plików albo co 10 s. Pełny checkpoint jest O(liczba plików), więc zapisuje się co `max(10 s, 10 × czas ostatniego zapisu)` (najwyżej ok. 10% czasu), a zawsze na końcu, przy przerwaniu i przy błędzie krytycznym. Aktualizacja stanu po pliku jest O(1) (słownik po ścieżce i zbiory liczników).

## Kompletność

`complete_snapshot: true` tylko gdy jednocześnie:

- inwentaryzacja ma `complete_inventory: true`,
- przebieg doszedł do końca bez przerwania i błędu krytycznego,
- każda ścieżka z inwentaryzacji ma rekord `complete` zweryfikowany w tym przebiegu (pobrany albo uwierzytelniony przy wznowieniu),
- żaden rekord nie ma `changed_since_inventory`,
- w `skipped` inwentaryzacji nie ma `inaccessible-directory`,
- inwentaryzacja nie zawiera ścieżek wykluczonych (`.env*`, `.bash_history`, `.zsh_history`). Takie pliki nie są pobierane i trafiają do `excluded`. Inwentaryzacja pomija je już na etapie listowania, więc ich pojawienie się oznacza problem do sprawdzenia.

Rekordy ścieżek spoza bieżącej inwentaryzacji zostają w manifeście, ale nie wpływają na kompletność.

## Testy

```sh
node --test tests/source-snapshot-worker.test.ts
```

Testy są syntetyczne i offline: fałszywy serwer FTP w procesie, losowy klucz i hasło (harness zna tylko jego hash). Pokrywają limit równoległości (1, 2, 4), okno zadań, szyfrowanie sprawdzane niezależnie przez Node `crypto`, wznowienie po podmianie bajtu i usunięciu obiektu, zmieniony manifest, `SIGTERM` z checkpointem i dokładnym wznowieniem, transfer zawieszony w `recv`, ponawianie plików, jednokrotne próby przy złym haśle i certyfikacie, warunki kompletności, rezerwę miejsca, blokadę, wykluczenia i brak sekretów na wyjściu. Python z `cryptography` wybiera zmienna `SNAPSHOT_TEST_PYTHON`, potem runtime Codexa, potem `python3`. Test rezerwy podmienia `free_bytes`; pozostałe działają na prawdziwym limicie 5 GB, więc przy mniejszej ilości wolnego miejsca na dysku z `$TMPDIR` zatrzymają się na `InsufficientSpace`.
