# BNB-First Customer Architecture

Liholiswano now uses a BNB-first customer path for the Testnet pilot.

## Primary customer path

Customer -> Binance Web3 Wallet (or another EVM wallet) -> Liholiswano dApp -> BNB Smart Chain -> Liholiswano smart contract -> test stablecoin.

The customer dApp is the primary interface. WhatsApp is optional and is not required for the core Testnet transaction journey.

## Components

- **Customer dApp:** `web/dapp.html`
- **Primary entry:** `web/index.html`
- **Owner/technical console:** `web/owner.html`
- **Account/operations dashboard:** `web/dashboard.html`
- **Render API:** authentication, optional profile/compliance, indexing, reconciliation, support and operational services.
- **Smart contract:** authoritative ROSCA financial controller.
- **Customer wallet:** customer-controlled EVM wallet; Binance Web3 Wallet is the preferred test wallet.

## Financial security model

The API does not custody customer funds and does not become an alternative ledger. Financial actions are signed by the customer's wallet and executed by the smart contract.

The contract remains authoritative for:
- group state
- membership
- contributions
- collateral
- bids
- settlement
- payout
- rotation/default logic

## Testnet

- Chain ID: 97
- Network: BNB Smart Chain Testnet
- Real money: prohibited
- Test tokens only

BNB Chain documents BSC Testnet as chain ID 97 and provides official wallet/network configuration and faucet guidance.

## Production boundary

This BNB-first dApp does not make the system production-ready by itself. Mainnet still requires external contract security review, real KYC/AML/sanctions/PEP controls, production RPC redundancy, operational key controls, monitoring, backups/recovery, legal/compliance review, and a finalized production stablecoin.

## Wallet compatibility

The dApp is written against the standard EVM provider interface. Binance Web3 Wallet is the preferred wallet for the pilot, while other EVM wallets remain compatible so the protocol is not unnecessarily locked to one wallet vendor.
