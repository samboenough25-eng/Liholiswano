# Liholiswano Financial Services Platform

## Active implementation

The active product branch is `bnb-app-complete` and targets BNB Smart Chain. The Solidity contract is the financial authority for group membership, collateral, contributions, bids, deadlines, defaults, settlement and rotation. The browser is a client and does not hold treasury keys.

This branch contains only the active BNB implementation. Obsolete blockchain implementations and duplicate staging packages are intentionally removed so there is one clear source of truth.

## Current validation

- `npm run check:all`
- `npm run compile`
- `npm test`
- `npm run e2e:local`
- `npm run validate:web`
- `npm run api:check`

These checks are enforced by the BNB GitHub Actions workflow.

## Testnet

Current network: BNB Smart Chain Testnet, chain ID 97.

Actual BNB Testnet deployment requires a dedicated deployer wallet funded with tBNB. The private key belongs only in the GitHub Actions secret `DEPLOYER_PRIVATE_KEY`. Never use a production wallet or share a seed phrase.

The Testnet deployment creates the Liholiswano protocol and a Testnet-only MockUSDT token. MockUSDT is not USDT or USDC and must never be used on Mainnet.

## Security status

The current contract has been hardened with:

- automatic full-group locking
- contract-enforced round deadlines
- permissionless deadline default/settlement triggering
- per-group escrow accounting
- reentrancy protection
- exact standard-token transfer checks
- two-step protocol ownership transfer
- regression tests for deadline, default, accounting and reentrancy behaviour

The contract is still unaudited. CI success is not a security audit and is not approval for Mainnet or real-money operation.

## Product-level work still required

The active BNB repository is a Testnet financial application foundation, not yet the complete regulated financial-service stack. Remaining gates include production-grade indexing and financial reconciliation, wallet/custody integration, KYC/biometric and AML/compliance provider integrations, notification delivery, monitoring and incident controls, independent security review, production stablecoin configuration, and applicable Botswana/Eswatini legal and compliance preparation.

## Source-of-truth rule

The root Solidity contract, root Hardhat configuration, `server/`, `web/`, `scripts/`, and `.github/workflows/` are the active implementation. There is no second blockchain implementation in this branch.


## Stage A KYC workflow

Stage A is a provider-neutral KYC development workflow. It is intentionally usable before a commercial KYC-provider account is available.

Implemented:
- customer KYC case creation/resume
- Botswana/Eswatini country binding
- legal name and date-of-birth capture
- national-ID/passport selection
- consent versioning and timestamp
- identity-document metadata and SHA-256 fingerprint recording
- no raw identity documents are persisted by Stage A
- explicit server-side KYC state transitions
- customer status/history endpoint
- compliance/admin case queue and case detail
- authorized manual approval/rejection/request-review decisions
- immutable-style case event history and audit records
- provider webhook boundary with HMAC-SHA256 verification and idempotent provider-event handling
- provider capabilities are exposed so the UI cannot imply that Stage A performed biometric or government-database verification

Stage A does **not** provide real biometric liveness, face matching, government ID database verification, sanctions/PEP screening, or production regulatory assurance. Those are provider/compliance integrations for later stages.

## WhatsApp-first customer architecture

Customers are designed to use Liholiswano primarily through WhatsApp and their verified phone number. The web application is the administrative, compliance and operations interface. WhatsApp commands are authenticated by the linked phone/account and financial actions require wallet authorization before any blockchain transaction is accepted. WhatsApp never directly holds or controls customer funds.

Customer commands include MENU, ACCOUNT, GROUPS, JOIN, CONTRIBUTE, BALANCE, PAYOUT, TX, SUPPORT and HELP. Every financial request is recorded and must reach on-chain confirmation before it is reported as completed.

### WhatsApp production prerequisites

The application contains the webhook, phone-linking, conversation-state and command layers. Production delivery still requires a WhatsApp Business/Cloud API account, permanent access token, phone-number configuration, webhook verification, app secret and approved templates where Meta requires them. These credentials belong in Render environment variables and must never be committed to GitHub.

### Wallet authorization

A verified wallet proves wallet ownership but does not authorize arbitrary financial actions. Production WhatsApp-only financial execution requires a secure signing/custody design, such as a controlled wallet-signing service or an explicitly supported wallet handoff. The API must never silently substitute a server-held treasury key for a customer's wallet.

### Transaction lifecycle

Financial requests use explicit states: prepared, signed, submitted, confirmed, reverted, failed, cancelled, and reconciliation_required. A transaction is not marked successful merely because a request was created; receipt status, chain, sender, target contract, function and group are verified before confirmation.

## Monthly platform subscription

Every registered customer has a separate monthly platform-subscription account:
- Botswana: P5.00/month
- Eswatini: E5.00/month
- payment asset: the configured BSC stablecoin
- destination: the configured Liholiswano subscription treasury
- ROSCA escrow and subscription revenue are separate accounting domains

The fiat fee is not converted by a hard-coded arbitrary stablecoin value. The stablecoin base-unit amount must be configured explicitly per country, with an optional recorded FX-rate snapshot. The subscription vault contract emits a unique payment event and prevents replay of the same customer-period payment.

The customer flow is:
WhatsApp request -> explicit confirmation -> one-time wallet authorization link -> wallet signs -> blockchain receipt -> server verifies event -> WhatsApp confirms payment.

The wallet authorization page is a signing surface only; it never asks for a seed phrase or private key. BNB Chain documentation confirms BSC is EVM-compatible and supports Binance Web3 Wallet, MetaMask and Trust Wallet, and Binance's current DApp testing guidance explicitly covers opening a DApp in the Binance Web3 Wallet browser and sending transactions. citeturn2search3turn1search0

## Reconciliation and recovery

The reconciliation worker now:
- treats a protocol-contract change as a new reconciliation domain and explicitly classifies open findings from the superseded contract as historical/superseded;
- verifies on-chain groups, members, escrow and indexed events;
- recovers prepared/submitted transaction requests from confirmed blockchain events after an API failure;
- reconciles subscription-vault events back into the subscription ledger;
- retains unresolved discrepancies instead of hiding them;
- uses finalized/safe block progress before advancing the reconciliation cursor.

The known historical `missing_group` discrepancy belongs to the previous Testnet contract domain; it is not deleted silently. A fresh deployment starts a new reconciliation domain. New Testnet E2E groups that are intentionally created only for blockchain testing must still be registered/classified before they are treated as production application groups.
