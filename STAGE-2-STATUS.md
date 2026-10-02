# Stage 2 status — BNB Smart Chain Testnet

## Verified completed

- Solidity ROSCA protocol contract.
- Automatic full-group locking.
- Contract-enforced round deadlines.
- Permissionless deadline/default/settlement triggering.
- Per-group escrow accounting.
- Reentrancy protection.
- Exact standard-token transfer checks.
- Two-step ownership transfer.
- Hardhat unit tests.
- Local three-wallet E2E.
- Browser static validation.
- BNB Testnet deployment workflow.
- PostgreSQL-backed blockchain event indexer.
- Persistent indexer cursor and block-hash validation.
- Idempotent event ingestion.
- Advisory-lock protection against concurrent indexers.
- BNB network and deployed-code validation.
- BNB API foundation.
- Transaction-request idempotency foundation.
- WhatsApp customer-channel foundation.
- BNB GitHub CI currently passes compile, tests, local E2E and web validation.

## Current Testnet deployment

- BNB Smart Chain Testnet: chain ID 97.
- Liholiswano: `0xe9b104260c940fAE26a73e4E9c952fD18fFd2014`
- MockUSDT: `0xb516a4a0ec39e3CBa5baDAE5524E05F43EB66C29`

MockUSDT is a development token only.

## Current live gate

The complete three-wallet BNB Testnet financial cycle has **not yet been
verified end-to-end**.

The controlled E2E workflow was initially blocked by a YAML parsing defect;
that workflow has now been corrected. The next execution reached the actual
Testnet cycle and failed for a real external prerequisite: the deployer wallet
had only about 0.000268 tBNB while the test attempted to fund three temporary
wallets with 0.01 tBNB each.

The E2E code has now also been corrected to:

- fail early with a precise minimum-balance message;
- use a smaller configurable temporary-member gas allocation;
- verify deployed contract and token bytecode;
- verify the test token is allowlisted;
- calculate the expected payout from the deployed protocol fee;
- correctly check the `totalWins` tuple field.

Therefore the remaining E2E blocker is **testnet gas funding**, not the YAML
workflow parser.

## Remaining production work

1. Complete the live Testnet ROSCA E2E.
2. Reconcile on-chain events with PostgreSQL.
3. Verify indexer restart/idempotency and reorg recovery.
4. Connect the managed-wallet provider.
5. Connect WhatsApp Business.
6. Connect biometric KYC and AML/compliance providers.
7. Harden keeper automation and transaction monitoring.
8. Complete independent security/audit work.
9. Configure a real production stablecoin only after the above gates.
10. Complete Botswana/Eswatini compliance and controlled launch preparation.

Testnet CI success is not a security audit or authorization for real-money
operation.
