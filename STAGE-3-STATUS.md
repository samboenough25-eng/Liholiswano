# Stage 3 — Financial Reconciliation & Production Operations

## Scope
Stage 3 establishes a durable operational control layer around the BNB Smart Chain financial contract.

## Implemented
- Persistent reconciliation cursor independent from the event indexer cursor.
- Block-hash cursor validation to stop on unexpected chain history changes.
- Incremental reconciliation over finalized blocks.
- On-chain group-state inspection for every protocol group.
- Database group and membership comparison.
- On-chain member-state snapshots per reconciliation run.
- Contract-token balance versus per-group escrow invariants.
- Aggregate escrow versus token-balance invariant.
- Direct validation of indexed events against fresh chain logs.
- Contribution transfer validation against the ERC-20 Transfer receipt.
- Settlement outgoing-transfer validation against `payout + bidAmount`.
- Financial ledger projection with deterministic chain references.
- Missing wallet mapping and missing ledger-entry detection.
- Blockchain transaction receipt/status checks.
- Durable discrepancy records with severity and operator resolution fields.
- PostgreSQL advisory locking to prevent concurrent reconciliation.
- Existing event indexer remains idempotent through unique `(chain_id, tx_hash, log_index)` storage.
- Testnet indexer/reconciliation workers can run automatically from the API service.

## Operational boundary
The smart contract remains the financial authority. Reconciliation never edits on-chain balances or settlement results.

A `critical` discrepancy is a control failure and must be investigated before real-money deployment.

## Required Testnet configuration
`ENABLE_TESTNET_INDEXER_WORKER=true`
`ENABLE_TESTNET_RECONCILIATION_WORKER=true`
`INDEXER_INTERVAL_MS=5000`
`RECONCILIATION_INTERVAL_MS=900000`
`RECONCILIATION_MAX_RANGE=100`
`RECONCILIATION_START_BLOCK` should be set once to the first block at or immediately before the current protocol deployment when a complete historical scan is required.

## Production gate still remaining
Stage 3 does not itself authorize Mainnet. Mainnet requires a dedicated RPC/indexing provider, independent smart-contract audit, production stablecoin selection, custody/signing controls, KYC/AML integrations, monitoring/alerting, operational runbooks, and applicable legal/compliance approvals.
