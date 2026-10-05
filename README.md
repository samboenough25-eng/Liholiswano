# Liholiswano Financial Services Platform

Liholiswano is a non-custodial, contract-automated rotating savings platform for BNB Smart Chain.

## V1 financial model

The smart contract is the financial source of truth. The API, indexer and keeper are read/trigger services only; they cannot choose recipients, funders, transfer customer funds, replace obligations or create liquidity.

Each tier forms fixed rounds of exactly 11 participants.

| Tier | Payout | Contribution | Collateral | Target | Maximum |
|---|---:|---:|---:|---:|---:|
| 1 | BWP/E200 | BWP/E20 | BWP/E40 | 12h | 24h |
| 2 | BWP/E400 | BWP/E40 | BWP/E80 | 24h | 36h |
| 3 | BWP/E600 | BWP/E60 | BWP/E120 | 24h | 48h |
| 4 | BWP/E800 | BWP/E80 | BWP/E160 | 24h | 48h |
| 5 | BWP/E100 | BWP/E10 | BWP/E20 | 12h | 24h |

- P = 10 × C.
- Every participant receives exactly one payout per round.
- Every participant has exactly 10 fixed obligations.
- There are exactly 110 obligations per round.
- Funding is deterministic and cyclic; no participant funds their own payout.
- A payout settles independently only when its own ten obligations satisfy F + D = P.
- F is actual token funding; D is valid collateral coverage from the defaulting funder.
- Solvent positions may settle out of order.
- BLOCKED_RECOVERY never transfers the obligation to another participant.
- Active membership and round parameters are immutable after activation.
- No mid-round voluntary exit, replacement, bailout or synthetic liquidity.
- A completed participant may withdraw collateral or explicitly opt into a subsequent round.
- Entry fee is BWP/E5 when newly joining the tier; continuation does not charge another entry fee.
- Three or more lifetime defaults classify the participant as HIGH_DEFAULT and suspend entry to the immediately following round.
- A default consumes exactly one contribution from the defaulting participant's collateral. Restoration is required before another exposed obligation can be paid/default-covered.

## Current implementation branch

v1.2-conformance-audit contains the conformance implementation and draft pull request for review.

The new contract is contracts/LiholiswanoV1.sol. The previous contracts/Liholiswano.sol is retained only as historical prototype code and is not the V1 financial authority.

## Customer and owner dApps

- web/dapp.html: customer wallet interface for waiting-list entry, round status, fixed obligations, collateral recovery and payout settlement.
- web/owner.html: owner interface for canonical tier configuration, activation and emergency pause only.
- Customers sign their own token transactions with their wallet.
- The owner cannot manually select who receives or who funds a payout.
- WhatsApp may be added as a notification/support channel later, but it is not a transaction signer.

## No-KYC V1 scope

V1 does not require a biometric KYC provider. Registration/account services are separate from the on-chain financial authority. Any future regulated deployment must add the applicable identity, AML, sanctions and legal controls before real-money operation.

## Automation

The keeper can detect expired open obligations, call the deterministic expiry processor, detect independently solvent payout positions, and call deterministic payout settlement. It has no discretionary financial authority.

## Testing

Run:

- npm run compile
- npm test
- npm run e2e:local
- npm run validate:web
- npm run check:all

The V1 test suite covers canonical tiers, 11-member formation, 110-obligation creation, active-round immutability, independent settlement, cross-position isolation, collateral defaults, blocked recovery, HIGH_DEFAULT suspension, withdrawal and re-entry.

## Testnet

Current network is BNB Smart Chain Testnet, chain ID 97. Testnet MockUSDT is test money only and is not USDT or USDC.

Never commit a private key or seed phrase. Testnet deployment must use a dedicated test wallet funded only with testnet assets.

## Security gate

Passing CI does not mean the protocol is safe for mainnet. Before real-money deployment, the V1 contract still requires adversarial token testing, fuzz/property testing, economic stress testing, independent security review, production stablecoin configuration, monitoring/reconciliation validation, and applicable Botswana/Eswatini legal and regulatory preparation.
