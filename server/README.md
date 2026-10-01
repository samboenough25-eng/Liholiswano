# Liholiswano API

The `server/` directory contains the Node.js API and operational services for the active BNB Smart Chain implementation.

## Responsibilities

- Customer account registration and authentication.
- Password hashing and short-lived JWT authentication.
- Botswana (BW) and Eswatini (SZ) customer records.
- KYC/compliance state and eligibility gating.
- PostgreSQL persistence.
- Transaction preparation and idempotency.
- Blockchain event indexing and reconciliation foundations.
- WhatsApp webhook/router foundation.
- Group metadata and membership records.
- Audit records and support controls.
- Health and operational status endpoints.

## Architecture rule

The API is **not** the financial authority. The BNB smart contract remains authoritative for membership lifecycle, contributions, bids, defaults, settlement, payouts and on-chain financial state.

The API may prepare and reconcile transactions, but it must never silently replace or override an on-chain financial result.

## Required production configuration

- `DATABASE_URL`
- `JWT_SECRET`
- `CORS_ORIGIN`
- `BSC_CHAIN_ID=97` for the current Testnet environment
- `BSC_TESTNET_RPC_URL`
- `BNB_CONTRACT_ADDRESS`

Additional integrations are required before customer financial transactions can be enabled:

- managed wallet provider
- WhatsApp Business Platform
- KYC provider
- AML/sanctions/PEP/compliance provider
- monitoring and alerting

## Wallet security

A wallet address supplied by a customer is not proof of control of that wallet. Financial transaction preparation must only use a wallet that has been verified by the intended wallet/provider verification mechanism.

Never store customer private keys in this API.

## Database

The API initializes the modular SQL files in `server/db/` when `DATABASE_URL` is configured. Schema changes should remain idempotent and should eventually move to an explicit versioned migration system.

## Current scope

This is an active Testnet foundation, not a completed production financial backend. Provider integrations, managed-wallet signing, live reconciliation, keeper hardening, monitoring, recovery controls, and operational/compliance workflows remain required before real-money operation.