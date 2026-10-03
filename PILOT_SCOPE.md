# Liholiswano BNB pilot — scope and honest limitations

This document describes the active BNB Smart Chain implementation. It is a Testnet pilot foundation, not the complete regulated financial-service product.

## Implemented and tested

- Solidity ROSCA contract on BNB Smart Chain Testnet.
- Minimum three-member groups with automatic full-group locking.
- Collateral and contribution transfers using an ERC-20-compatible token.
- Highest-bid winner selection with deterministic first-member tie breaking.
- Contract-enforced round deadlines.
- Permissionless settlement/default triggering according to contract rules.
- Per-group escrow accounting.
- Exact token-transfer checks.
- Reentrancy protection.
- Two-step ownership transfer.
- Protocol fee configuration with a contract-enforced maximum.
- Hardhat unit tests and a local three-wallet E2E.
- Live BNB Testnet three-wallet financial E2E.
- Testnet deployment workflow.
- PostgreSQL event indexer with persistent cursor, block-hash validation, idempotent event ingestion and advisory locking.
- API foundation for accounts, KYC/compliance state, wallets, groups, transaction preparation, support, WhatsApp and audit records.

## Deliberately deferred

- Managed/embedded wallet provider integration and transaction signing.
- Production WhatsApp Business integration.
- Production KYC/biometric identity verification.
- AML, sanctions, PEP and adverse-media provider integration.
- Production notification delivery.
- Fully hardened keeper automation, retries, nonce management and alerting.
- Independent smart-contract security audit.
- Production reconciliation and financial operations controls.
- Mainnet stablecoin configuration.
- Full Botswana and Eswatini legal/compliance implementation.
- Replacement-member/waitlist and richer savings schedules from the larger product specification.

## Testnet contracts

- Liholiswano: `0xe9b104260c940fAE26a73e4E9c952fD18fFd2014`
- MockUSDT: `0xb516a4a0ec39e3CBa5baDAE5524E05F43EB66C29`
- BSC Testnet chain ID: 97

MockUSDT is a development token. It is not USDT or USDC and must never be used as a production stablecoin.

## Production boundary

Testnet success is not a security audit, regulatory approval, custody approval or authorization to operate a real-money financial service.


## Current Testnet onboarding decision

Because external KYC providers cannot currently be connected, the Testnet pilot uses **WhatsApp-linked pilot verification** as its onboarding gate.

Pilot flow:
1. Customer creates a Liholiswano account.
2. Customer links and verifies the WhatsApp number they control.
3. Customer sends `VERIFY` on WhatsApp.
4. WhatsApp collects legal first/last name, date of birth, the last four ID/passport digits, and explicit pilot consent.
5. The API records the pilot verification and audit event.
6. Testnet ROSCA financial actions require this pilot verification plus a cryptographically verified BNB wallet.

This pilot verification does **not** perform government-ID verification, biometric face matching, liveness detection, AML/sanctions/PEP screening, or other regulated KYC checks. Those controls remain a Mainnet/production gate until the required providers and compliance processes are connected.
