# Liholiswano on-chain pilot — scope and honest limitations

This is a **pilot-scoped subset** of the frozen Protocol V2 spec, built to
get a real group transacting real tokens on Stellar Testnet — not the full
28-day-epoch, multi-schedule system the spec describes.

## What's actually implemented and tested

- `create_group` / `join_group` / `lock_group` — group lifecycle, admin-gated
  where the spec calls for it.
- Real token transfers via the standard Soroban token interface: collateral
  moves on `join_group`, contributions move on `contribute`, payouts and
  bonus shares move on `settle_round`. Nothing is bookkeeping-only.
- Compulsory bidding in basis points, with a configurable max.
- Settlement: winner = highest bid (ties broken by lowest member index,
  matching the JS simulator so results are comparable across the two).
  Bid sacrifice splits by **floor division**, remainder to reserve — the
  same money-conservation rule validated in the simulator, now re-verified
  here against **real token balances**, not an in-memory ledger.
- Default handling: seizes collateral into reserve, covers what a member
  who already won this rotation still owes, logs anything beyond collateral
  as an explicit, permanent, on-chain `total_uncovered_shortfall` — never
  invented or hidden.

**10/10 unit tests pass** (`cargo test`), including two that specifically
exercise real token balances end-to-end:
`settle_round_conserves_value_with_uneven_split` and
`default_seizes_collateral_and_logs_uncovered_shortfall`. Run them yourself:

```
cd contract && cargo test
```

## What's deliberately deferred from the full spec

- **No 28-day epoch calendar or day-21/day-27 deadlines.** `settle_round`
  fires whenever everyone required has acted — there's no on-chain clock
  enforcing "must act by day N." For a pilot, the admin/group coordinates
  timing off-chain (WhatsApp: "everyone contribute and bid by Friday").
- **No automatic default detection.** `mark_default` is an explicit admin
  call — nothing watches for a missed deadline and calls it for you. Same
  trust assumption as the pilot's PIN model: the admin isn't cryptographically
  constrained to act fairly, just given the only key that can call it.
- **No replacement-member waitlist.** A defaulted slot just stays empty;
  nobody new can take an existing member's collateral position (the spec's
  full replacement flow isn't built).
- **Single flat collateral, single contribution schedule per group** — the
  spec's per-schedule contribution options aren't modeled.
- **Admin is a single Stellar address, not a multisig.** For real money,
  a shared admin key is a real risk — the same caveat the pilot's README
  already gives for the PIN model, just relocated to a private key.

## What I could NOT verify from this environment, and why

- **The contract does not compile to an actual `.wasm` binary here.**
  `wasm32-unknown-unknown` has no Rust standard library installed in this
  sandbox (confirmed: `cargo build --target wasm32-unknown-unknown` fails
  immediately on core prelude items like `Option::Some`). This is the exact
  same limitation an earlier session hit. **You must build the `.wasm`
  yourself** — see DEPLOY.md. The Rust *logic* is tested natively via
  `cargo test`, which doesn't need the wasm target, so the tests above are
  real, but the compiled artifact you'll actually deploy has not been
  produced or run by me.
- **No access to Stellar Testnet or Soroban RPC from this sandbox**
  (network egress to `soroban-testnet.stellar.org` returns
  `host_not_allowed`). I have not deployed this contract anywhere, and have
  not exercised `web/pilot-onchain.html` against a live RPC endpoint or a
  real Freighter wallet. That file's Soroban SDK method names and the
  Freighter API shape match the documented interfaces as of this writing,
  but Soroban tooling moves fast — if a call throws about a missing or
  renamed method, check the current `@stellar/stellar-sdk` docs rather than
  assuming the contract itself is wrong.

## Recommended pilot rollout

1. Deploy to Testnet only, with a testnet token (see DEPLOY.md) — never
   real value, until independently reviewed.
2. Run it with 3–5 people you trust for a couple of rounds before
   widening it, same as the off-chain pilot's own advice.
3. Keep the off-chain (`index.html` + Apps Script) version running in
   parallel as the "source of truth" UI for members while you validate the
   on-chain path — don't cut over member-facing usage until you've
   personally walked through create → join → lock → contribute → bid →
   settle → a real default at least once on Testnet.
