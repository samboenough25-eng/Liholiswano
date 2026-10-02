# Liholiswano Financial Services Platform

## Active implementation

The active product branch is `bnb-app-complete` and targets BNB Smart Chain. The Solidity contract is the financial authority for group membership, collateral, contributions, bids, deadlines, defaults, settlement and rotation. The browser is a client and does not hold treasury keys.

This branch contains only the active BNB implementation. Obsolete blockchain implementations and duplicate staging packages are intentionally removed so there is one clear source of truth.

## Current validation

- `npm run check:all`
- `npm run compile`
- `npm test`
- `npm run e2e:local`
- `npm run validate:web`
- `npm run api:check`

These checks are enforced by the BNB GitHub Actions workflow.

## Testnet

Current network: BNB Smart Chain Testnet, chain ID 97.

Actual BNB Testnet deployment requires a dedicated deployer wallet funded with tBNB. The private key belongs only in the GitHub Actions secret `DEPLOYER_PRIVATE_KEY`. Never use a production wallet or share a seed phrase.

The Testnet deployment creates the Liholiswano protocol and a Testnet-only MockUSDT token. MockUSDT is not USDT or USDC and must never be used on Mainnet.

## Security status

The current contract has been hardened with:

- automatic full-group locking
- contract-enforced round deadlines
- permissionless deadline default/settlement triggering
- per-group escrow accounting
- reentrancy protection
- exact standard-token transfer checks
- two-step protocol ownership transfer
- regression tests for deadline, default, accounting and reentrancy behaviour

The contract is still unaudited. CI success is not a security audit and is not approval for Mainnet or real-money operation.

## Product-level work still required

The active BNB repository is a Testnet financial application foundation, not yet the complete regulated financial-service stack. Remaining gates include production-grade indexing and financial reconciliation, wallet/custody integration, KYC/biometric and AML/compliance provider integrations, notification delivery, monitoring and incident controls, independent security review, production stablecoin configuration, and applicable Botswana/Eswatini legal and compliance preparation.

## Source-of-truth rule

The root Solidity contract, root Hardhat configuration, `server/`, `web/`, `scripts/`, and `.github/workflows/` are the active implementation. There is no second blockchain implementation in this branch.


## Stage A KYC workflow

Stage A is a provider-neutral KYC development workflow. It is intentionally usable before a commercial KYC-provider account is available.

Implemented:
- customer KYC case creation/resume
- Botswana/Eswatini country binding
- legal name and date-of-birth capture
- national-ID/passport selection
- consent versioning and timestamp
- identity-document metadata and SHA-256 fingerprint recording
- no raw identity documents are persisted by Stage A
- explicit server-side KYC state transitions
- customer status/history endpoint
- compliance/admin case queue and case detail
- authorized manual approval/rejection/request-review decisions
- immutable-style case event history and audit records
- provider webhook boundary with HMAC-SHA256 verification and idempotent provider-event handling
- provider capabilities are exposed so the UI cannot imply that Stage A performed biometric or government-database verification

Stage A does **not** provide real biometric liveness, face matching, government ID database verification, sanctions/PEP screening, or production regulatory assurance. Those are provider/compliance integrations for later stages.