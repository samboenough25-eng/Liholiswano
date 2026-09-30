# Liholiswano Financial Services Platform

## Active implementation

The active product branch is `bnb-app-complete` and targets BNB Smart Chain. The Solidity contract is the financial authority for group membership, collateral, contributions, bids, deadlines, defaults, settlement and rotation. The browser is a client and does not hold treasury keys.

## Current validation

- `npm run compile`
- `npm test`
- `npm run e2e:local`
- `npm run validate:web`

These checks are enforced by the BNB GitHub Actions workflow.

## Testnet

Actual BNB Testnet deployment requires a dedicated deployer wallet funded with tBNB. The private key belongs only in the GitHub Actions secret `DEPLOYER_PRIVATE_KEY`. Never use a production wallet or share a seed phrase.

The Testnet deployment creates the Liholiswano protocol and an unrestricted MockUSDT test token. MockUSDT is Testnet-only and must never be used on Mainnet.

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

## Legacy material

Older Stellar/Soroban source and documentation remain in this repository for historical reference. They are not the active BNB implementation. The obsolete Stellar GitHub workflows have been removed from this branch.

## Product-level work still required

The active BNB repository is currently an on-chain/Testnet application foundation, not the entire regulated financial-service stack. Account management, KYC/AML provider integration, notifications, production backend/indexing, monitoring, reconciliation, customer support controls, and Botswana/Eswatini legal/compliance work still require separate implementation and verification.