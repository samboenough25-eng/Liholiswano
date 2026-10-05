# Liholiswano V1.2 — Solidity State Machine

## 1. Round model

A round is a fixed set of exactly 11 participants in one tier.

For participant set R where |R| = 11:

- each participant receives exactly one payout P;
- each participant owes exactly one contribution C to each of the other 10 participants;
- therefore each participant has exactly 10 obligations;
- P = 10C;
- every participant contributes exactly 10C during a fully completed round;
- total contributions = 11P;
- total payouts = 11P.

A participant entering after round formation belongs to a future round and cannot mutate the active round.

## 2. Round states

WAITING
- participant has joined the tier waiting list;
- no active-round obligation exists.

FORMING
- the protocol is collecting eligible participants;
- membership is not yet an active financial round.

ACTIVE
- exactly 11 members are fixed;
- membership and economic parameters are snapshotted;
- payout order is fixed/deterministic;
- no new member can enter the round.

PAYOUT_IN_PROGRESS
- one member is the current recipient;
- exactly 10 contributor obligations exist for that recipient;
- each contributor can satisfy at most one obligation for this payout.

PAYOUT_SETTLED
- recipient has received exactly P;
- that recipient cannot receive another payout in the same round;
- next recipient becomes active.

COMPLETED
- all 11 participants have received their single payout;
- all 110 obligations have been satisfied or validly collateral-covered;
- round is closed.

PAUSED/RECOVERY
- global emergency state may halt selected actions;
- the protocol must retain a deterministic recovery path and must never confiscate user funds merely because the frontend/backend is unavailable.

## 3. Participant states

WAITING
ELIGIBLE
ACTIVE_RECIPIENT
ACTIVE_OBLIGOR
DEFAULTED
RESTORATION_REQUIRED
HIGH_DEFAULT
BLOCKED_RECOVERY
COMPLETED

A participant cannot be both an active recipient and the same payout's contributor.

A participant cannot receive a second payout in the same round.

## 4. Obligation state

Each obligation contains:

- roundId
- tierId
- recipient
- funder
- amount
- dueAt
- status

Statuses:

UNASSIGNED
ASSIGNED
PAID
COLLATERAL_COVERED
DEFAULTED
CANCELLED

V1.2 should never use CANCELLED to erase a financial liability after payout has occurred.

## 5. Payout invariants

For every payout:

fundedCount == 10 before settlement.

For each obligation:

amount == contribution.

At settlement:

actualContributionAmount + collateralCoveredAmount == payoutAmount.

The recipient receives exactly payoutAmount once.

## 6. Collateral invariant

For an eligible participant:

collateral >= requiredCollateral.

When a missed obligation is covered:

collateral decreases by exactly contribution.

A participant with insufficient collateral cannot be treated as solvent.

## 7. Option D

If collateral is insufficient after a default:

- do not replace the participant;
- do not transfer the obligation to another participant;
- do not mint/create credit;
- do not fabricate a successful contribution;
- mark the position as impaired;
- preserve the unresolved economic state;
- require restoration/recovery according to protocol rules.

An unrelated participant must never inherit the failed participant's liability.

## 8. HIGH_DEFAULT

defaultCount increments exactly once for each valid default.

When defaultCount >= 3:

status = HIGH_DEFAULT.

HIGH_DEFAULT blocks entry into the next round until the defined recovery conditions are satisfied.

Historical defaults are not erased by collateral restoration.

## 9. Round formation

The contract must never activate a round unless there are exactly 11 participants meeting the required eligibility/collateral conditions.

If fewer than 11 are eligible, users remain in the waiting list.

If more than 11 are waiting, the first eligible 11 form the next round. Remaining users stay queued for later rounds.

## 10. Round parameter snapshot

At activation, snapshot:

- token
- payout
- contribution
- collateral requirement
- payment window
- participant membership
- payout order

Changing the tier configuration later cannot alter an already active round.

## 11. Automation

The blockchain state must be sufficient for permissionless automation.

Keeper actions may advance protocol state, but a keeper must not have discretionary financial authority.

The keeper can call deterministic transitions such as:

- form round when eligible;
- assign next obligation;
- mark deadline expiry;
- apply permitted collateral coverage;
- settle a fully funded payout;
- advance to next payout.

No backend database is authoritative.

## 12. Failure/liveness principle

Solvency has priority over forced liveness.

If a valid economic transition cannot occur because funds are genuinely unavailable, the protocol must preserve the truthful impaired state rather than inventing liquidity.

## 13. Required test invariants

For every randomized sequence:

1. no participant receives >1 payout per round;
2. every payout has exactly 10 obligations;
3. every obligation has exactly one funder and one recipient;
4. a funder cannot satisfy the same payout twice;
5. recipient cannot fund their own payout;
6. total payout <= actual contributions + valid collateral coverage;
7. collateral cannot become negative;
8. default count cannot decrease;
9. HIGH_DEFAULT is sticky for the defined round-entry restriction;
10. active round membership cannot change;
11. active round parameters cannot change;
12. no user can withdraw active collateral;
13. no failed obligation is transferred to another participant;
14. no payout can occur twice;
15. no obligation can be satisfied twice;
16. completed round has exactly 11 payouts;
17. completed round has exactly 110 satisfied/validly covered obligations;
18. new waiting-list users cannot alter an active round.
