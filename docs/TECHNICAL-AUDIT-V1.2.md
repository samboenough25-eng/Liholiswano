# Liholiswano V1.2 — Full Technical Conformance Audit

Date: 2026-10-06
Baseline: bnb-app-complete @ 8d3bf1efeb6583cfbda55342769d5f0f35db2d5e
Target specification: Liholiswano Economic Specification V1.2

## Executive result

The BNB implementation is a functional prototype of the earlier continuous-queue/funder model, but it is NOT yet conformant with the finalized V1.2 economic specification.

The most important mismatch is architectural: V1.2 requires fixed 11-member rounds, one payout per participant per round, exactly 10 contribution obligations per payout recipient, explicit obligation completion/recovery states, and Option-D collateral failure handling. The current contract instead runs one continuous queue and immediately requeues a payout recipient.

No mainnet deployment is approved from this baseline.

## Locked V1.2 economic invariants

1. Exactly five product tiers: BWP 100, 200, 400, 600, 800.
2. Contribution = payout / 10.
3. Collateral requirement is tier-configured; current approved baseline is 2 x contribution.
4. Entry fee = BWP/E5 for V1.
5. A valid round contains exactly 11 participants.
6. Active-round membership is immutable.
7. Each participant receives at most one payout in a round.
8. A payout recipient has exactly 10 obligations in that round.
9. Each obligation is for exactly one contribution amount.
10. Each participant is a contributor for the other 10 participants in the same 11-member round.
11. New entrants cannot modify an active round; they wait for a later round.
12. Payout is released only when all ten obligations are satisfied by actual contribution or valid collateral coverage.
13. No invented liquidity.
14. No mid-round replacement.
15. No obligation transfer to another participant.
16. Collateral failure follows Option D: the impaired position remains impaired; the protocol does not replace the participant or manufacture liquidity.
17. Collateral restoration is required before the participant regains the relevant eligibility.
18. Three or more defaults trigger HIGH_DEFAULT and next-round suspension under V1.2.
19. Active-round economic parameters are immutable for that round.
20. The smart contract, not frontend/backend/admin, is the financial authority.

## Findings

### CRITICAL C01 — Continuous queue instead of fixed rounds
Current code moves the recipient to the queue tail after payout. This is incompatible with fixed 11-member rounds.

### CRITICAL C02 — No obligation ledger
Participant state has receivedCount/fundedCount/defaultCount but no obligationsTotal, obligationsRemaining, obligationsCompleted, roundId, or obligation records.

### CRITICAL C03 — No one-payout-per-round invariant
A participant can receive payouts repeatedly in the same continuous queue.

### CRITICAL C04 — No explicit 11-member round formation
The current contract can create payout state before 11 eligible participants exist.

### CRITICAL C05 — No HIGH_DEFAULT enforcement
defaultCount increments but does not enforce the V1.2 three-default suspension state.

### CRITICAL C06 — Recovery only checks collateral
restoreCollateral makes a participant eligible again without checking unresolved obligations, round state, or HIGH_DEFAULT.

### CRITICAL C07 — Backend ABI is stale
server/blockchain.js and automation/indexer code reference the former group/bid protocol rather than the current tier/funder protocol.

### CRITICAL C08 — Web validation is stale
validate-web.js expects old UI IDs and does not validate the current waiting-list UI.

### CRITICAL C09 — Current dApp script contains malformed JavaScript
The default-current-funder handler contains an invalid statement boundary. The current frontend cannot be treated as validated until this is corrected.

### CRITICAL C10 — Reconciliation/indexing model is stale
The operational backend expects old GroupCreated/MemberJoined/BidSubmitted-style events rather than TierCreated/JoinedQueue/FunderAssigned/FunderPaid/FunderDefaulted/RecipientPaid.

### HIGH H01 — Active-round parameters are not snapshotted
updateTier can change paymentWindow while a live queue exists.

### HIGH H02 — Tier product definition is not enforced
Owner can create arbitrary tiers up to MAX_TIERS instead of the five approved product tiers.

### HIGH H03 — Subscription module conflicts with V1
Recurring subscriptions remain in the repository although they are not part of the locked V1 economic model.

### HIGH H04 — No formal conservation invariant
The tests do not prove that every payout is backed by contributions plus valid collateral deductions.

### HIGH H05 — No adversarial ERC20 suite
Reentrancy is considered, but malformed/fee-on-transfer/no-return/false-return token behavior needs explicit tests.

### HIGH H06 — No property/fuzz testing
The economic state machine has no randomized invariant test suite.

### MEDIUM M01 — Entry fee and token decimals are hard-coded to 6 decimals
Acceptable for the controlled BNB testnet mock token, but must be explicit in production token configuration.

### MEDIUM M02 — MAX_QUEUE_SCAN creates a liveness boundary
A large queue can become operationally unserviceable if eligible candidates are beyond the scan limit.

### MEDIUM M03 — Pause semantics need formal specification
Pause must not accidentally strand recovery or settlement in a way that creates an unrecoverable financial state.

## Required remediation order

1. Freeze the V1.2 state machine.
2. Replace the continuous queue model with explicit rounds.
3. Add round membership and one-payout-per-round state.
4. Add explicit 10-obligation accounting.
5. Implement Option-D recovery/blocked states.
6. Implement HIGH_DEFAULT.
7. Enforce five product tiers.
8. Snapshot immutable round parameters.
9. Add conservation and state-machine invariants.
10. Rewrite the unit/E2E/property test suite.
11. Rewrite dApp ABI/UI around the new contract.
12. Rewrite backend/indexer/reconciliation/keeper ABI and event model.
13. Run local 11-participant, 12–20 participant, default, restoration and multi-round simulations.
14. Deploy a fresh BSC Testnet contract.
15. Run funded 11-wallet E2E.
16. Run adversarial/security tests.
17. Only then consider mainnet gates.

## Mainnet decision

NOT READY.

The current contract should be treated as a testnet prototype only until all CRITICAL and HIGH findings above are resolved and the complete invariant suite passes.
