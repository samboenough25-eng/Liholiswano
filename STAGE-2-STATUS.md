# Stage 2 status — BNB Smart Chain Testnet

## Completed in code

- Solidity ROSCA protocol contract
- automatic full-group locking
- contract-enforced round deadlines
- permissionless deadline/default/settlement triggering
- per-group escrow accounting
- reentrancy protection
- exact standard-token transfer checks
- two-step ownership transfer
- Hardhat unit tests
- local three-wallet E2E
- browser static validation
- BNB Testnet deployment workflow
- PostgreSQL-backed blockchain event indexer
- persistent indexer cursor and block-hash validation
- idempotent event ingestion
- advisory-lock protection against concurrent indexers
- BNB network and deployed-code validation
- BNB API foundation
- transaction-request idempotency foundation
- WhatsApp customer-channel foundation

## Current live blockers

The complete BNB Testnet financial cycle has not yet been live-verified.

Required next steps:

1. Deploy Liholiswano to BNB Testnet.
2. Verify the public contract address and deployment block.
3. Configure the Render API with DATABASE_URL, JWT_SECRET and BNB contract configuration.
4. Configure the indexer.
5. Run the indexer against the deployed contract.
6. Verify blockchain events in PostgreSQL.
7. Configure the intended managed-wallet provider.
8. Execute a real three-wallet Testnet ROSCA lifecycle.
9. Reconcile on-chain events against database transaction records.
10. Harden keeper automation and operational monitoring.

## Security

The active BNB contract remains unaudited. Automated tests are evidence of tested behaviour, not a security audit or approval for Mainnet or real-money operation.

Testnet MockUSDT is a development token only.