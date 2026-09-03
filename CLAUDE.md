# underwater-demo

Demo nowej strony i sklepu dla Underwater.pl (centrum nurkowe, Warszawa). Next.js 16 + Payload CMS 3 (SQLite), jedna aplikacja: front + panel `/admin`.

- Dev: `pnpm dev` (port 3011). Seed danych ze starej strony: `pnpm seed` (pomija, jeśli produkty już są; `--force` dodaje ponownie).
- Adresy URL są 1:1 jak na obecnej stronie (`/3625-maska-soprastek-corona.html`, `/kursy-nurkowania/padi-open-water-diver.html`) — obsługuje je `src/app/(site)/[...slug]/page.tsx`.
- Kolekcje: `src/collections/*` (Produkty, Kategorie, Kursy, Wyprawy, Aktualności, Zgłoszenia, Zamówienia). Ustawienia globalne: `src/globals/Settings.ts`.
- Zmiana schematu: `pnpm exec payload migrate:create <nazwa>` i commit `src/migrations/`. Na produkcji `scripts/start.sh` odpala `payload migrate`, seed i `next start`.
- Deploy: Coolify (projekt `underwater-demo`, Dockerfile), domena `underwater.programo.pl`, wolumen `/data` (baza + media). Zmienne: `PAYLOAD_SECRET`, `DATABASE_URI=file:/data/payload.db`, `MEDIA_DIR=/data/media`, `NEXT_PUBLIC_SERVER_URL`.
- Login demo do panelu: `demo@underwater.pl` / `underwater2026`.
