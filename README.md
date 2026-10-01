# Liholiswano Financial Services Platform

Liholiswano is a community rotating-savings (ROSCA) financial-services platform designed for Botswana, Eswatini, and future Southern African expansion.

## Active implementation

The current implementation targets **BNB Smart Chain**.

- Active development branch: `bnb-app-complete`
- Smart-contract language: Solidity
- Target test network: BNB Smart Chain Testnet (chain ID 97)
- Backend: Node.js / Express
- Database: PostgreSQL
- Customer channel: WhatsApp-first
- Staff, compliance, and operations: web application
- Wallet architecture: managed/embedded wallet infrastructure
- Blockchain events: PostgreSQL indexer and reconciliation layer

The BNB smart contract is the financial authority for ROSCA state and enforces group membership, collateral, contributions, bids, deadlines, defaults, settlement, payouts, rotation, protocol fees, escrow accounting, and approved-token rules.

The backend and customer interfaces must not bypass the contract's financial rules.

## Repository status

The BNB implementation is under active development. An API or frontend being online does **not** mean the platform is a production financial-service deployment.

Current major components include:

- Solidity ROSCA contract
- automated contract tests
- local end-to-end ROSCA test
- Node.js API
- PostgreSQL schemas
- authentication and role controls
- transaction-request and idempotency layer
- WhatsApp command/router foundation
- blockchain event indexer
- reconciliation foundation
- customer/staff web foundation
- KYC and compliance provider adapters
- keeper/automation foundation

## Validation

Core local validation commands:

```bash
npm run compile
npm test
npm run e2e:local
npm run validate:web
npm run api:check
npm run indexer:check
```

Passing CI or local tests demonstrates behaviour under the tested conditions. It does **not** constitute an independent security audit, regulatory approval, custody approval, or permission to operate a real-money financial service.

## BNB Testnet deployment

The Testnet deployment uses a dedicated deployment wallet funded with tBNB.

The deployment process creates:

1. the Liholiswano protocol contract; and
2. a MockUSDT token for Testnet testing.

MockUSDT is a development/test token. It has no claim to real USDT value and must never be treated as a Mainnet stablecoin.

The deployer private key must only be stored in a secure secret-management system such as a GitHub Actions secret. Never commit private keys, seed phrases, or wallet credentials to the repository or share them in chat.

The live Testnet contract address is intentionally not documented here until an actual BNB Testnet deployment has been completed and verified.

## Customer architecture

The intended customer experience is WhatsApp-first:

```
Customer
   |
WhatsApp
   |
Liholiswano API
   |
Identity / KYC / Compliance
   |
Managed Wallet
   |
BNB Smart Contract
```

Staff and compliance users use the web application against the same backend and financial engine.

WhatsApp is an interface, not the treasury. The backend records identity, compliance, conversations, support, and operational data, while the blockchain remains authoritative for on-chain financial state.

## Security status

The current contract includes protections and regression tests covering:

- automatic full-group locking
- contract-enforced round deadlines
- permissionless deadline/default/settlement triggering
- per-group escrow accounting
- reentrancy protection
- exact standard-token transfer checks
- two-step protocol ownership transfer
- duplicate contribution/bid handling
- default and shortfall accounting

The smart contract has **not** undergone an independent external audit.

Additional work remains for economic/invariant testing, operational incident controls, wallet security, transaction reconciliation, monitoring, and production hardening.

## Production-readiness work

Before any controlled real-money deployment, the project still requires verification and implementation of items including:

- real BNB Testnet contract deployment
- PostgreSQL production connection and migrations
- secure managed-wallet integration
- blockchain indexing and reconciliation against live transactions
- keeper/automation hardening
- WhatsApp provider integration
- KYC integration
- AML/sanctions/PEP screening integration
- compliance review workflows
- notifications
- staff/compliance portal completion
- monitoring and alerting
- customer support controls
- security testing and independent smart-contract audit
- stablecoin selection and production token verification
- Botswana and Eswatini legal/regulatory review
- controlled Testnet and pilot validation

## Legacy Stellar material

Earlier development used Stellar/Soroban. That work is historical and is no longer the active financial architecture for this repository.

The separate Stellar contract repository and historical Stellar artifacts should not be treated as the current BNB deployment.

## Environment rule

Testnet addresses, MockUSDT, test credentials, and tBNB are for development/testing only. They must not be presented as production assets or Mainnet configuration.
