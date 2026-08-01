# Repository deployment manifest — Abyssal Battleships

**Audited:** 2026-08-01  
**Deployment decision:** Published — invite-gated public anonymous gameplay demo on the Leaseweb VPS.

## What it is

An owned MIT-licensed browser Battleships game. Its Node service keeps one
game's authoritative boards in memory and uses local `ruvector` n-gram recall
to demonstrate how completed anonymous board positions can influence later AI
targeting. A SHA-256 commit-and-reveal flow makes the return target inspectable
after a player shot.

## Evidence reviewed

- Clean Git working tree before this readiness work; origin is
  `dgdev25/battleships`.
- `npm ci` completed with **0 reported vulnerabilities** and `npm test` passed
  **16/16** tests on 2026-08-01.
- The source has no account, credential, upload, payment, model-provider, or
  third-party browser request path. Game inputs are bounded to 256 KB; authoritative enemy
  ship geometry is omitted until the end of a game.
- `deploy/Dockerfile.showcase` builds a non-root Node 22 image, exposes only
  port 8080, uses no mounted volume, and passes a read-only-root filesystem
  smoke run. `/health` returns `synthetic-showcase`.
- Public showcase mode withholds memory export/reset routes and hides both
  controls in the UI. It returns generic request errors and uses short HTTP
  request/header deadlines.
- The project owner confirmed on 2026-08-01 that its six supplied MP3
  recordings are copyright-free and may be included in the hosted image. The
  existing audio-source note also records the public-domain Ogg samples.
- Two 1600×930 browser-rendered technical **PNG** maps were created from CSS/HTML
  sources. Every text surface passed overflow checks; no technical SVG is used.
- Local browser acceptance at 1440px and 390px found no page-width overflow,
  no broken images, hidden export/reset controls, and working `config → game →
  fire` API flow.

## Hosted demo contract

The prospective VPS image sets `BATTLE_SHOWCASE_MODE=true` and writes only to
`/tmp/abyssal-memory`. Episodes contain board coordinates and hit outcomes,
not visitor identifiers. There is no volume, backup target, database, or
external network dependency, so a container/image restart discards them.
The invite-gated platform remains the sole access boundary.

## Hosted acceptance — 2026-08-01

- Source commits `03d40ea`, `9927582`, `0245a5e`, and `ab50bcb` each passed
  the GitHub Actions quality workflow: clean install, **16/16** tests, source
  syntax check, image build, and constrained container contract.
- Leaseweb application `wvvc613bg6nhxf0bbha6l1u0` runs the non-root Node 22
  image on port 8080. Its internal `/health` reports
  `{"status":"healthy","mode":"synthetic-showcase"}`.
- `https://battleships.demos.lyledg.com` has canonical TLS and returns `401`
  with `noindex` headers before redemption. The portfolio registry reports it
  as `public-card`, `live`, and `demo`.
- A temporary project-scoped invite successfully redeemed, loaded the real
  game, scattered a fleet, engaged, and resolved one player/API/AI turn.
  Browser acceptance confirmed the export/reset controls were hidden, there
  was no page-width overflow, and the only API calls were config, game, and
  fire on the same demo origin. No third-party resource request occurred.
- Every temporary acceptance invite was revoked immediately after the check.
- The product page is live at `https://lyledg.com/project/battleships` with
  both checked 1600×930 technical PNG maps and desktop/mobile overflow passes.
