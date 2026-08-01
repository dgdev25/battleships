# Repository deployment manifest — Abyssal Battleships

**Audited:** 2026-08-01  
**Deployment decision:** Candidate — container and public-demo contract prepared; register only after final source/CI and hosted acceptance.

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
  browser secret path. Game inputs are bounded to 256 KB; authoritative enemy
  ship geometry is omitted until the end of a game.
- `deploy/Dockerfile.showcase` builds a non-root Node 22 image, exposes only
  port 8080, uses no mounted volume, and passes a read-only-root filesystem
  smoke run. `/health` returns `synthetic-showcase`.
- Public showcase mode withholds memory export/reset routes and hides both
  controls in the UI. It returns generic request errors and uses short HTTP
  request/header deadlines.
- The source included six owner-supplied MP3 recordings without a documented
  redistribution licence. They are excluded from the hosted image; documented
  public-domain Ogg samples and Web Audio fallbacks remain. This does not alter
  local development assets.
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

## Remaining admission actions

1. Commit and push this readiness set to the owned source origin; add the
   existing project-level CI gate if it is absent.
2. Register as `public-card`, build on Leaseweb, then confirm internal health,
   external TLS/invite gate, absent MP3 assets, and an actual one-turn browser
   flow with a temporary invite.
3. Copy the checked PNGs to the portfolio's product-map asset set, add the
   catalogue preview record, and run desktop/mobile visual acceptance at
   `https://lyledg.com/project/battleships`.
