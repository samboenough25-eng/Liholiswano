# Liholiswano — full blockchain pilot package

Read **PILOT_SCOPE.md** first — it says plainly what's tested vs. what
isn't, and why. Short version: the contract's economic logic is genuinely
tested (10/10 tests, real token transfers, verified conservation). The
compiled `.wasm` and the frontend's live behavior against Testnet are
**not** verified from this environment — no wasm32 toolchain, no network
access to Stellar. You'll be the first to actually run both.

## What's in here

| Path | What it is |
|---|---|
| `contract/` | The Soroban smart contract (Rust). `cargo test` from inside this folder to re-run the 10 tests yourself. |
| `web/pilot-onchain.html` | Browser frontend — Freighter wallet + real Soroban RPC calls. Open after deploying (see DEPLOY.md). |
| `DEPLOY.md` | Step-by-step: install toolchain → build → deploy to Testnet → configure the frontend → walk through one full cycle. |
| `PILOT_SCOPE.md` | What's implemented, what's deferred from the full spec, and exactly what I could/couldn't verify. |
| `index.html`, `Code.gs`, `sw.js`, `liholiswano-pilot.jsx` | The existing **off-chain** pilot (Google Apps Script backend) — kept in this package so you can run both side by side while validating the on-chain path. Unchanged from the version already fixed for you, except as noted below. |
| `protocol-v2-simulation-engine.js`, `protocol-v2-stress-test.js` | The economic model, already stress-tested — the contract's settlement math mirrors this exactly (floor-split, remainder-to-reserve). |

## Suggested order of operations

1. `cd contract && cargo test` — confirm the logic on your own machine.
2. Follow `DEPLOY.md` to get a real contract ID on Testnet.
3. Open `web/pilot-onchain.html` locally (or host it — it's a static file,
   same as `index.html`), point it at your contract ID, and walk through
   create → join → lock → contribute → bid → settle → default with people
   you trust, using play-money testnet tokens only.
4. Keep the off-chain app (`index.html`) running for actual member-facing
   use until you've personally verified the on-chain path end-to-end.

## Relationship to the earlier work

This isn't a rewrite of the off-chain pilot — it's a separate, parallel
implementation of the same protocol rules, now backed by an actual smart
contract instead of a Google Apps Script JSON blob. Nothing here changes
how `index.html` talks to `Code.gs`; the two tracks are independent until
you decide to migrate one onto the other.
