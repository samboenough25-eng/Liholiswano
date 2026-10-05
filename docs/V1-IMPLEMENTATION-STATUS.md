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
