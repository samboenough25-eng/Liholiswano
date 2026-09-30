# Liholiswano — BNB Smart Chain

This branch is the active BNB Smart Chain implementation.

## Contract architecture

The smart contract is the financial authority. Group locking, contribution/bid deadlines, defaults, winner selection, payouts and rotation are contract-enforced. A keeper may trigger eligible transactions but cannot override the contract rules.

Security hardening currently includes per-group escrow accounting, reentrancy protection, exact token-transfer checks, two-step ownership transfer, automatic full-group locking, and deadline-based permissionless settlement/default triggering.

## Testnet deployment

Actual BNB Testnet deployment still requires a dedicated deployer wallet funded with tBNB. Store only that wallet private key in GitHub Actions as DEPLOYER_PRIVATE_KEY. Never use a production wallet or share a seed phrase.

The deployment workflow runs compile, unit tests, local E2E and frontend validation before deployment.

## Test token

MockUSDT is an unrestricted Testnet-only token. It must never be used on Mainnet.

## Production gate

The contract remains unaudited. Passing CI is not equivalent to production safety. Independent smart-contract review, adversarial/economic testing, operational monitoring, and applicable Botswana/Eswatini compliance work remain required before real-money production use.