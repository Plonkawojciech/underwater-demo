# Underwater: kandydat lokalnej migracji, 9 października 2026

## Cel i granice

Gotowy kandydat CLI do migracji na oznaczonej, izolowanej kopii lokalnej SQLite. Domyślny tryb to dry-run; zapis wymaga `--apply-local`. Nie było połączenia do bazy klienta, odczytu jego SQL, wykonania migracji u klienta, deployu ani serwera. Właściwy bieżący SQL nadal czeka na Wojtka. Źródło tej próby jest w całości syntetyczne.

Praca odbyła się w `underwater_migration`, gałąź `orchestrator/20261009-underwater_migration`, od HEAD `5f20b59`. Oryginalny checkout był tylko do odczytu. Root zatwierdził utworzenie NOWEJ bazy syntetycznej istniejącymi 11 migracjami. Nie zmieniono schematu ani migracji projektu. Nie zainstalowano zależności i nie modyfikowano współdzielonego `node_modules`.

## Decyzje i pliki

- `scripts/import/local-migration-contract.ts`: allowlist CLI/pakietu, SHA wejść, wersje importera/schematu/lockfile, marker celu, zakaz symlinków i `.env*`, zgodność opublikowanych 301 z handoff SEO, jawne luki kont/historii oraz powiązanie resume z pakietem i kopią.
- `scripts/import/local-migration.ts`: wymuszone ustawienia lokalne/test, sprawdzenie rzeczywistego URI bazy i katalogu mediów, ledger schematu, blokada procesu, niezmienne checkpointy, dry-run z SHA wszystkich tabel/mediów, zachowanie ręcznych zmian przez istniejący importer i SHA historii prywatnej.
- `scripts/import/run-local-migration.mjs`: kompilacja grafu zgodna z native runnerem repo i uruchomienie CLI/harnessu bez serwera; sprząta własny katalog tymczasowy.
- `scripts/import/prove-local-migration.ts`: zachowany harness prawdziwego SQLite i istniejącego importera na nowych sztucznych danych; obecna wersja dodatkowo kontroluje SHA tracked źródeł projektu.
- `scripts/import/verify-migration-final.py`: parametryczna końcowa bramka dla checkoutu integracyjnego, logi/manifest, rzeczywiste domyślne CLI oraz kontrola SHA projektu. `--skip-repo-checks` jawnie oddaje kontrakty/typecheck do nadrzędnego pipeline i nie poświadcza ich wyniku.
- `tests/local-migration.test.ts`: obecnie 9 testów walidacji kontraktu. Nowe przypadki obejmują wyłączenie generacji Payload i odrzucenie `.env*` wskazanego jako źródłowe medium.
- `docs/implementation/local-migration.md`: format wejść, uruchomienie, wznowienie, dowód oraz bramka po integracji.

Kont i prywatnej historii aktualny adapter nie importuje. Każdy raport pozostawia `sourceComplete: false` oraz `clientCutoverReady: false`; kompletność obsługiwanej publicznej części ma osobne pole `publicBundleComplete`. Ręczne poprawki i operacyjny stan magazynu zostają zachowane; nie usuwamy metadanych importera ani nie tworzymy duplikatu w celu rozstrzygnięcia konfliktu. Konflikt trafia do opiekuna źródła.

## Dowody wykonane

Pierwszy zestaw kontraktu zaliczył **7/7**, zero fail/skip/cancel, exit 0, 8634.896791 ms:

```sh
/Users/wojciechplonka/.codex/bin/heavy node --import tsx --test tests/local-migration.test.ts
```

Log: `/Volumes/Mad Dog/Archive/codex-work/client-orchestrator-20261009/artifacts/underwater_migration/contract-tests.log`. Ten wynik poprzedza dwa nowe testy oraz końcową ochronę przed generowaniem plików projektu; nie jest wynikiem obecnych 9 testów.

Pierwszy rzeczywisty harness na nowej syntetycznej bazie zakończył się exit 0:

```sh
/Users/wojciechplonka/.codex/bin/heavy node scripts/import/run-local-migration.mjs --prove "/Volumes/Mad Dog/Archive/codex-work/client-orchestrator-20261009/artifacts/underwater_migration"
```

Cały zachowany wynik: `/Volumes/Mad Dog/Archive/codex-work/client-orchestrator-20261009/artifacts/underwater_migration/synthetic-migration-df76cf71-cec1-4f41-8da6-6c2d5b22ef64/`.

- `proof.json`: domyślny dry-run zachował SHA wszystkich tabel i mediów; local apply utworzył 4 publiczne encje i 1 obraz; replay wykazał 4 unchanged, 0 created i 0 updated.
- `target/underwater-test.db`, `target/media/`: zachowana prawdziwa baza i media. Sztuczne istniejące konto, zamówienie i kontakt zostały zachowane; ręczna nazwa produktu, stan 2, ręczna strona i medium pozostały. Zmiana źródła zgłosiła 1 konflikt. Utrata potwierdzenia po rzeczywistym zapisie została wznowiona z checkpointu bez duplikatów.
- `source/`: bundle, manifest, handoff, obraz i druga rewizja źródła. `reports/`: checkpointy preflight/applying/finished/failed. Wszystko pozostaje na Mad Dog.
- `synthetic-proof-v1.log` w katalogu nadrzędnym: inicjalizacja istniejących 11 migracji i wynik harnessu.

Ta pierwsza próba **nie spełniła ochrony plików projektu**: development init Payload automatycznie wygenerował `src/payload-types.ts` (+246/-10). Root wykrył zmianę. Przywrócono wyłącznie ten własny wygenerowany plik do dokładnych bajtów HEAD. CLI oraz harness dostały kopiowaną konfigurację z `typescript.autoGenerate: false` i `admin.importMap.autoGenerate: false`; współdzielona konfiguracja pozostaje nienaruszona. Obecny harness i helper wymagają SHA plików projektu przed/po. Stary dowód potwierdza powyższe zachowanie bazy/mediów na syntetycznych danych, ale nie stanowi finalnego dowodu obecnego kandydata.

Pakiet SEO od osobnego zadania: `/Volumes/Mad Dog/Archive/codex-work/client-orchestrator-20261009/evidence/underwater-seo/migration-20261009.handoff.json`, SHA256 `9c50e9b879635e5795df30cd4f3f3f1e3172dadafcbbfd04451e6304c30f6c6d`. Bezpośrednio potwierdzono bajty SHA i nagłówki: audit safe, zero blocking issues, 627 routes, 245 decisions, own preview ready, client cutover false. Runtime migratora używał dotąd tylko syntetycznego handoffu; złożenie rzeczywistego publicznego bundle z tym handoffem nie było wykonane w tym zadaniu.

## Końcowy kandydat i bramki do wykonania przez roota

Przy przekazaniu `6f891901b5940da75a07572e8b377fa417bb20ef` **NOT RUN** obejmowało: obecne 9 testów, końcowy typecheck, ponowny harness z ochroną generacji/SHA projektu, rzeczywiste domyślne CLI oraz dokładny review tego kandydata. Statyczne sprawdzenie składni helpera i `git diff --cached --check` odnotowano przy przekazaniu. Późniejsza próba roota zakończyła typecheck błędem; szczegóły i zakres poprawki poniżej. Nie zgłaszamy gotowości main ani wdrożenia.

Własny wrapper PID 64177 był tylko w kolejce, bez wejścia do aktywnych globalnych slotów. Po weryfikacji właściciela i polecenia został anulowany; sesja 41358 zakończyła się **143**, `final-gate.log` jest pusty. Żaden etap tego gate nie wystartował. Wcześniejsze własne anulowane kolejki także nie są wynikami testów. Cudzych procesów i blokad nie zmieniono.

Root wykonuje jedną pełną bramkę na zamrożonym zintegrowanym kandydacie. Samodzielny helper:

```sh
UNDERWATER_REPO="/Volumes/Mad Dog/Archive/codex-work/client-orchestrator-20261009/integrate_underwater"
/Users/wojciechplonka/.codex/bin/heavy python3 "$UNDERWATER_REPO/scripts/import/verify-migration-final.py" \
  --repo "$UNDERWATER_REPO" \
  --artifacts "/Volumes/Mad Dog/Archive/codex-work/client-orchestrator-20261009/artifacts/underwater_migration"
```

Ścieżkę `--repo` należy wskazać na rzeczywisty checkout integracyjny; helper nie zakłada nazwy worktree. Jeżeli nadrzędny pipeline już obejmuje te same kontrakty i typecheck, dodać `--skip-repo-checks` i poświadczyć te etapy wynikiem pipeline. Wewnątrz już działającego wrappera `heavy` wywołać samo `python3 ...`, bez drugiego wrappera.

Zależności: zamontowany Mad Dog i istniejący katalog artifactów, Git, Python 3 (tylko stdlib), Node 22.22, pnpm 10.33 oraz istniejące zależności z lockfile (Payload 3.90.2, tsx 4.23.15, TypeScript 5.9.3, esbuild, SQLite/libsql i sharp). Bez instalacji; brak serwera, portu i sekretu klienta. Helper generuje tylko syntetyczny runtime secret w pamięci. Nowy wynik zachowa w `final-gate-UUID/manifest.json` i nowym `synthetic-migration-UUID/proof.json`, z dokładnymi exit codes i SHA logów.

## Korekta po nieudanej bramce integracyjnej roota

Root uruchomił pełną bramkę na integration HEAD `e8e80f3d95f1cc75bfa414339cd534e0ef477dc2`. Log `/Volumes/Mad Dog/Archive/codex-work/client-orchestrator-20261009/evidence/integrate_underwater/final-gate/cms/underwater-cms-gate-aIU6Zh/build-webpack.log` potwierdza kompilację webpack w 4,2 min i następnie **FAILED TypeScript**: TS2345 w linii 35 oraz pięć TS18046 w liniach 50, 52, 61 i 67 kontraktu. Nie jest to zaliczony build ani zaliczona bramka. Log i wcześniejsze dowody pozostały zachowane.

Przyczyną była postać pomocnika `reject`: TypeScript 5.9.3 nie zachowywał zawężenia `unknown` po wywołaniu arrow-const, mimo adnotacji zwrotu `never`. Zastąpiono go deklaracją `function reject(code: string): never`. Wszystkie warunki walidacji, kody błędów i zachowanie runtime pozostają identyczne. Nie dodano rzutowań, nie osłabiono strażników, nie zmieniono schematu ani innych plików aplikacji.

Lekka statyczna analiza rzeczywistych deklaracji dotkniętych błędem odtworzyła przed poprawką dokładnie sześć diagnostyk z logu roota; po poprawce wykazała zero. Obejmowała tylko te deklaracje, bez grafu aplikacji, emisji, builda, serwera lub wykonania migracji. Wynik: `/Volumes/Mad Dog/Archive/codex-work/client-orchestrator-20261009/artifacts/underwater_migration/ts-narrowing-static.json` (TS 5.9.3). Pełnego typecheck/builda ani testów ponownie nie uruchamiano w worktree; końcowy wynik obecnego kandydata czeka na dokładny review, cherry-pick i ponowny pipeline roota.

## Pozostałe blokery źródła i następny krok

Potrzebny uprawniony aktualny eksport SQL Joomla/VirtueMart z wersjami i uzgodnioną datą/migawką, aktualne dane handlowe oraz decyzja właściciela o zachowaniu kont, historii i pierwszym logowaniu. Stare kopie 2016/2018 i publiczny crawl nie potwierdzają tego zakresu. Hasła klienta, rezerwacje i historia prywatna nie są przeniesione przez ten adapter; nie obiecujemy kompletności ani ciągłości logowania. SEO nadal wymaga rozstrzygnięcia 245 pozycji przed finalnym cutover.

Prowadzący integruje commit, wykonuje pełny pipeline i dokładny review, dopiero potem decyduje o main zgodnie z zakresem sesji. Kandydat nie jest wypchnięty ani wdrożony. Nie zostawiono własnych serwerów, kart przeglądarki ani procesów pomocniczych; zachowane bazy, source i proof pozostają do odbioru.
