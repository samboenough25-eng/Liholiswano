# Liholiswano WhatsApp-First Architecture

## Decision

Liholiswano will use WhatsApp as the primary customer channel and retain a web portal for staff, compliance and operations.

## Principles

- The BNB smart contract remains the authority for ROSCA financial state.
- PostgreSQL stores identity, KYC/compliance, conversations, support and indexed operational data.
- The WhatsApp adapter is a user interface, not a treasury.
- Wallet infrastructure signs only authorized transactions.
- A keeper triggers contract functions when their on-chain rules make them callable.
- Backend services must never bypass contract rules.

## Customer flow

Phone/WhatsApp -> identity verification -> KYC/compliance -> wallet -> ROSCA discovery -> join -> contribution -> bid -> settlement -> payout -> next round.

## Interface contract

The first customer menu is:

1. My account
2. Join a ROSCA
3. My groups
4. Contribute
5. My balance
6. Next payout
7. Transactions
8. Support

Every financial action must be idempotent and produce an auditable record.

## Authentication

A WhatsApp number is an identifier, not sufficient authorization for high-risk financial actions. The system must bind the WhatsApp identity to a Liholiswano customer and wallet authorization state. KYC status controls eligibility.

## Financial authority

The API may prepare and submit transactions, but the contract validates membership, deadlines, amounts, bids, settlement and payout. The database is not a competing financial ledger.

## Rollout

1. Build a provider-neutral WhatsApp webhook/adapter.
2. Implement conversation state and idempotency.
3. Connect identity and KYC status.
4. Connect wallet service.
5. Connect existing ROSCA API and contract service.
6. Add automated reminders and keeper jobs.
7. Add blockchain event indexing and reconciliation.
8. Run a complete BNB Testnet ROSCA cycle before production use.

## Production gate

WhatsApp, wallet, KYC/compliance providers and legal/regulatory requirements must be verified separately. No provider integration is considered live until its credentials, API behavior and end-to-end tests succeed.
