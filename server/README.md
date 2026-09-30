# Liholiswano API — Track A

This directory is the first backend foundation for the BNB implementation.

## Responsibilities

- Customer account registration and login.
- Password hashing with bcrypt.
- Short-lived JWT authentication.
- Country-aware customer records for Botswana (BW) and Eswatini (SZ).
- KYC status and eligibility gating.
- PostgreSQL persistence.
- Blockchain transaction tracking schema.
- Group metadata and membership schema.
- Audit records for security-sensitive application events.
- Health endpoint for Render monitoring.

## Important architecture rule

The API is not the financial authority. The BNB smart contract remains authoritative for membership lifecycle, contributions, bids, defaults, settlement, payouts and on-chain balances.

The API stores application identity, compliance state, metadata, transaction references and audit information. It must never silently change an on-chain financial result.

## Environment

Copy .env.example to .env locally. Never commit .env.

Required production variables:

- DATABASE_URL
- JWT_SECRET
- CORS_ORIGIN

Optional:

- PORT
- DATABASE_SSL
- JWT_EXPIRES_IN

## Database

Apply server/db/schema.sql to the PostgreSQL database before using authenticated routes.

For Render, use the database's internal connection string where the API and database are in the same Render region.

## Current scope

This is a foundation, not a completed production financial backend. Provider integrations (KYC/AML, email/SMS), admin workflows, reconciliation/indexing, recovery controls and operational monitoring are next.
