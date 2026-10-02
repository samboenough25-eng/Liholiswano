# BNB implementation status

## Verified

- Solidity ROSCA protocol contract.
- Automatic full-group locking.
- Contract-enforced round deadlines.
- Permissionless deadline/default/settlement triggering.
- Per-group escrow accounting.
- Reentrancy protection.
- Exact standard-token transfer checks.
- Two-step ownership transfer.
- Hardhat contract tests.
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
- Live BNB Testnet three-wallet financial E2E: PASS.

## Current Testnet deployment

- BNB Smart Chain Testnet: chain ID 97.
- Liholiswano: `0xe9b104260c940fAE26a73e4E9c952fD18fFd2014`
- MockUSDT: `0xb516a4a0ec39e3CBa5baDAE5524E05F43EB66C29`

MockUSDT is a development token only.

## Current integration gate

The smart-contract financial cycle is proven on Testnet. The remaining technical gate is the off-chain financial data path:

1. index every emitted contract event reliably;
2. catch up without public-RPC rate-limit failures;
3. reconcile indexed events against application groups, memberships, transactions and ledger entries;
4. prove restart/idempotency and reorg handling;
5. verify operational monitoring and alerting.

The current indexer is an event indexer with reconciliation foundations; it is not yet a complete business-state reconciliation engine.

## Production work still required

1. Complete live PostgreSQL reconciliation.
2. Harden RPC/indexer infrastructure.
3. Verify indexer restart/idempotency and reorg recovery.
4. Connect the managed-wallet provider.
5. Connect WhatsApp Business.
6. Connect biometric KYC and AML/compliance providers.
7. Harden keeper automation and transaction monitoring.
8. Complete independent security/audit work.
9. Configure a real production stablecoin only after the above gates.
10. Complete Botswana/Eswatini compliance and controlled launch preparation.

Testnet success is not a security audit or authorization for real-money operation.
