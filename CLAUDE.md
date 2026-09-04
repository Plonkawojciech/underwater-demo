# underwater-demo

Demo nowej strony i sklepu dla Underwater.pl (centrum nurkowe, Warszawa). Next.js 16 + Payload CMS 3 (SQLite) w jednej aplikacji: front i panel `/admin`.

- Dev: `pnpm dev` (port 3011). Seed: `pnpm seed` (pomija, gdy dane już są; `--force` dokłada).
- **Zakres jest celowo mały — to demo, nie migracja.** Trzy główne ekrany: strona główna, sklep (lista + kategoria + karta produktu) i kurs. Do tego kontakt i koszyk. Dane: 6 kategorii, 3 produkty, 5 kursów.
- Adresy URL 1:1 jak na obecnej Joomli (`/3625-maska-soprastek-corona.html`, `/kursy-nurkowania/padi-open-water-diver.html`) — obsługuje je `src/app/(site)/[...slug]/page.tsx`. To argument sprzedażowy: pozycje w Google zostają.
- Kolekcje: `src/collections/*` (Produkty, Kategorie, Kursy, Zgłoszenia, Zamówienia, Media, Użytkownicy) + globalne `Ustawienia strony` (`src/globals/Settings.ts`).
- Design: ciemna baza (`--abyss`), ciepły papier (`--shell`), akcent mosiądz (`--brass`). Newsreader na nagłówki, Archivo na tekst, IBM Plex Mono na dane techniczne. Cały system w `src/app/(site)/globals.css`.
- Zdjęcia scen (hero, wyprawa, kurs, serwis, sklep) wygenerował Codex — `assets-gen/`, kopie w `public/img/` i `seed-media/`. Zdjęcia produktów pochodzą z obecnej strony klienta.
- Zmiana schematu: `pnpm exec payload migrate:create <nazwa>`, commit `src/migrations/`. `push: false` — schemat idzie wyłącznie migracjami, więc dev nie pyta o zmiany.
- Deploy: Coolify (projekt `underwater-demo`, Dockerfile), domena `underwater-demo.programo.pl` (działa też `underwater.programo.pl`), wolumen `/data` na bazę i media. `scripts/start.sh` robi migrate + seed + start.
- Panel demo: `demo@underwater.pl` / `underwater2026`.
