# Underwater: korekta ścieżki backupu po native gate r4

## Stan wejściowy i ownership

Diagnoza dotyczy dokładnego integration HEAD `7570c465e34fe7ff1d209d597d96b639d9794d50`. Własny czysty worktree przełączono na NOWĄ gałąź `orchestrator/20261009-underwater_migration-backup-path` od tego SHA. Poprzednia gałąź `orchestrator/20261009-underwater_migration` z HEAD `384a140219a4d6f988dee54aa037e1558f0ca2e5` pozostaje zachowana. Nie edytowano checkoutu integracyjnego ani oryginalnego.

Root przydzielił wyłącznie `tests/backup.test.ts`, `src/payload.config.ts` i ten raport. Zmiana nie obejmuje bazy, schematu, skryptu backupu, wygenerowanych typów, asercji, skipów ani timeoutów. Bez odczytu `.env*`, sekretów, instalacji, serwera i powtórzenia heavy.

## Dokładny FAIL

Log `/Volumes/Mad Dog/Archive/codex-work/client-orchestrator-20261009/evidence/integrate_underwater/final-gate-r4/full-native.log` kończy się exit 1: **364/369 PASS, 5 FAIL, 0 skip, 0 cancelled**, czas testów 114623.198542 ms. Wszystkie pięć błędów pochodzi z `tests/backup.test.ts`, testy 13–17:

- live WAL backup/restore: Python kończy exit 2, zanim otworzy skrypt;
- ciphertext/header/wrong-key: pierwsze tworzenie backupu kończy exit 2;
- unsafe tar members: konstruktor archiwów kończy exit 1 na importowaniu nieistniejącej ścieżki modułu;
- occupied destination: pierwsze tworzenie backupu kończy exit 2;
- symlink/secret/unsafe paths/reserve: Python kończy exit 2 na brakującym pliku zamiast zwrócić oczekiwany błąd braku miejsca.

Wspólna ścieżka z logu: `/Volumes/Mad%20Dog/.../scripts/backup/underwater_backup.py`. To błędne rozwiązywanie lokalnej ścieżki w fixture, nie obciążenie ani wynik wykonania mechanizmu backupu/restore. `new URL(...).pathname` zachowuje kodowanie URL `%20`; Python potrzebuje ścieżki systemu plików. Właściwy plik w checkoutach istnieje. Prowadzący potwierdził osobno rzeczywiste PASS CMS build/typecheck/50 E2E; pełny native gate pozostaje FAILED.

## Minimalne poprawki

W `tests/backup.test.ts` dodano import `fileURLToPath` z `node:url`; `SCRIPT` używa teraz `fileURLToPath(new URL(..., import.meta.url))`. Wszystkie pięć testów i ich asercje pozostają identyczne. Nie zmieniono wyboru Pythona ani probe zależności.

W `src/payload.config.ts` dodano tylko `typescript.autoGenerate: false`, zachowując istniejący `outputFile`. Jest to jawnie przydzielona przez roota poprawka konfiguracji inicjalizacji, aby bramka nie generowała tracked plików projektu. Zainstalowany Payload 3.90.2 w `dist/index.js:359` uruchamia `generate:types` przy nieprodukcyjnym init, jeśli ta flaga nie jest `false`; ścieżka odświeżania konfiguracji ma ten sam warunek w linii 495. Globalna konfiguracja integration7570 nie zawierała tej flagi.

W root integration po bramce odczytano `src/payload-types.ts` +246/-10: zmiany zaczynają się od opisów pól/etykiet CMS i odpowiadają wcześniejszemu, potwierdzonemu przypadkowi generatora Payload. Wcześniejszy migrator wyłączał generację tylko w kopiowanej konfiguracji własnego CLI/harnessu przez `localPayloadConfig()`, więc nie osłaniał pozostałych native testów inicjalizujących zwykły config. Wygenerowanego pliku roota nie dotykano; root zachowuje diff i bajty HEAD do własnego przeglądu oraz kontrolowanego przywrócenia.

## Walidacja i następny krok

Wykonano wyłącznie lekką kontrolę statyczną. Node rozwiązał rzeczywisty URL testu w own worktree na Mad Dog: stara ścieżka z `%20` nie istnieje, nowa poprawnie wskazuje istniejący skrypt. Nie uruchomiono Pythona, backupu, restore ani testów. Dowód: `/Volumes/Mad Dog/Archive/codex-work/client-orchestrator-20261009/artifacts/underwater_migration/backup-path-static.json`.

Dokładne porównanie bajtów względem integration7570 potwierdziło: test zmienia wyłącznie import i rozwiązanie URL, wszystkie pięć ciał testowych pozostaje zachowane, konfiguracja zmienia wyłącznie `autoGenerate: false`. Diff-check wykonano przed przekazaniem. Brak nowych dowodów PASS runtime: pełną bramkę obecnego kandydata prowadzący ponowi po review i cherry-picku. Wszystkie wcześniejsze logi FAIL i dowody pozostają zachowane. Nie zostawiono własnych procesów pomocniczych.
