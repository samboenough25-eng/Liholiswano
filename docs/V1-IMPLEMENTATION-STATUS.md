# V1.3/D-B implementation status

Date: 2026-10-06

## Completed in the conformance branch

The branch now contains a replacement V1 financial contract rather than incremental changes to the old queue prototype.

### On-chain financial authority

contracts/LiholiswanoV1.sol implements:

- exactly five canonical tiers;
- exact V1 payout/contribution/collateral values;
- exactly 11 members per active round;
- immutable active-round membership;
- 110 fixed obligations per round;
- deterministic cyclic funder assignment;
- no self-obligation;
- one payout position per member;
- independent position settlement;
- F + D = P enforcement through obligation resolution;
- collateral-only default coverage;
- BLOCKED_RECOVERY without replacement or transfer;
- restoration before another exposed obligation;
- lifetime default history;
- HIGH_DEFAULT at 3+ defaults with one-round suspension;
- no mid-round exit;
- post-completion collateral withdrawal;
- explicit next-round opt-in;
- one-time BWP/E5 entry fee for new tier entry;
- owner pause/configuration controls without discretionary participant selection.

### Customer dApp

web/dapp.html now reads the V1 round, position and obligation state and gives the customer wallet-controlled actions for joining, paying fixed obligations, recovery, opt-in, collateral withdrawal and payout settlement.

### Owner dApp

web/owner.html now exposes canonical five-tier configuration, activation and emergency pause. It does not expose arbitrary payout creation or manual participant settlement.

### Backend/operations

- server/blockchain.js uses the V1 ABI.
- server/automation.js is a trigger-only V1 keeper for expired obligations and independently solvent payout positions.
- server/reconcile.js records V1 round/obligation snapshots and checks fixed-round invariants.
- scripts/deploy.js deploys the V1 protocol and all five canonical testnet tiers.
- scripts/e2e-local.js runs a V1 fixed-round E2E.
- scripts/validate-web.js validates the V1 UI contract boundary.

## Verified CI result

GitHub Actions run for commit 8dcf76c55cb2a9472ea7469c3f08578020349184 completed successfully.

Verified in CI:

- JavaScript syntax: PASS
- API syntax: PASS
- operational worker syntax: PASS
- Solidity compile: PASS
- contract tests: PASS — 19 passing
- local V1 E2E: PASS
- web validation: PASS
- production dependency audit: PASS — 0 production vulnerabilities

The CI environment also reported non-blocking Node.js/action deprecation warnings.

## Not yet authorized

This is not a mainnet or real-money release.

Before deploying this V1 contract to BNB Testnet for live multi-wallet testing, the remaining gates are:

1. replace the old testnet contract address in deployment/config only after a fresh V1 deployment;
2. run the dedicated V1 testnet deployment;
3. run multi-wallet testnet E2E with 11 real test wallets;
4. test default and BLOCKED_RECOVERY behavior on-chain;
5. validate indexer and reconciliation against the new deployment;
6. add adversarial ERC20 tests and property/fuzz tests;
7. review gas costs for round activation and the 110-obligation initialization;
8. complete security review;
9. only then consider any mainnet preparation.

The existing testnet address must not be treated as a V1 deployment.

## Additional hardening completed on 2026-10-06

- Canonical target/max windows are now enforced on-chain: T1 12h/24h, T2 24h/36h, T3 24h/48h, T4 24h/48h, T5 12h/24h.
- Collateral token rotation is blocked while any participant remains joined, preventing a completed participant's old-token collateral from being treated as a new-token reserve.
- Added adversarial token fixtures/tests for false-return, no-return, fee-on-transfer and reentrant callback behavior.
- Added deterministic 23-participant batching coverage: two active rounds of 11 and one waiting participant.
- Disabled legacy KYC and group API routes for V1 so those old workflows cannot authorize or create V1 financial groups.
- Cleaned the environment example to state that V1 financial authorization is not KYC-gated and that legacy subscriptions/groups are outside the V1 protocol.
- Added a dedicated manual GitHub Actions testnet deployment/E2E workflow. It deploys a fresh V1 contract and mock token and exercises 12 test wallets. Public BSC RPCs cannot time-travel, so deadline/default/recovery remains covered by local deterministic tests; the testnet gate covers real wallet/contract deployment and early settlement.

## Current gate

The branch remains a draft. The old deployed testnet contract address in web/config.js is intentionally not replaced until the fresh V1 testnet deployment succeeds. No claim of fresh-testnet deployment is made yet.
