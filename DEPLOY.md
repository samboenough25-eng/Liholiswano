# Liholiswano BNB Smart Chain deployment

This is the active deployment guide for the bnb-app-complete branch.

## Network

Current target:
- BNB Smart Chain Testnet
- Chain ID 97
- Native gas token: tBNB

## 1. Dedicated deployment wallet

Create a dedicated BNB Testnet deployment wallet and fund it with tBNB.

Do not use a production wallet. Never commit or share the private key.

For GitHub Actions, store the deployment key only as the repository secret DEPLOYER_PRIVATE_KEY.

## 2. Local validation

Run:

```bash
npm install
npm run compile
npm test
npm run e2e:local
npm run validate:web
npm run api:check
```

All checks should pass before deployment.

## 3. Testnet deployment

Use .github/workflows/deploy-bnb-testnet.yml.

The workflow deploys:
1. Liholiswano
2. MockUSDT
3. MockUSDT approval in Liholiswano

The workflow records the public deployment addresses as an artifact.

## 4. Verify the deployment

Confirm:
- chain ID is 97
- Liholiswano contains contract code
- MockUSDT contains contract code
- MockUSDT is approved
- the intended deployer is the contract owner
- only Testnet assets are being used

MockUSDT is a development token. It is not USDT or USDC and must never be treated as a production stablecoin.

## 5. Configure the API

Set:

```text
BSC_CHAIN_ID=97
BSC_TESTNET_RPC_URL=<verified BNB Testnet RPC>
BNB_CONTRACT_ADDRESS=<verified Liholiswano address>
```

For the indexer:

```text
INDEXER_CONFIRMATIONS=3
INDEXER_MAX_BLOCK_RANGE=1000
INDEXER_INITIAL_LOOKBACK=5000
INDEXER_START_BLOCK=<deployment block>
```

Using the deployment block is preferred.

## 6. Configure PostgreSQL

Set DATABASE_URL.

Before indexing, verify that the database contains:
- indexer_state
- chain_events
- reconciliation_runs
- transaction_requests

## 7. Run the indexer

Run:

```bash
npm run indexer:check
```

The indexer validates the BSC chain, contract bytecode, cursor state and block hash. It records contract events and uses a PostgreSQL advisory lock to prevent concurrent indexers.

## 8. Test the complete Testnet lifecycle

Test:

1. Create a group.
2. Join with at least three test wallets.
3. Verify collateral.
4. Lock the group.
5. Contribute.
6. Submit bids.
7. Settle.
8. Verify payout and fee.
9. Verify rotation.
10. Test deadline/default behaviour.
11. Verify blockchain events in PostgreSQL.
12. Restart the indexer and verify resume/idempotency.
13. Compare indexed data with on-chain state.

## Security boundary

The BNB contract remains authoritative for financial state.

The backend must not manually override on-chain financial outcomes.

Customer private keys must never be stored in the API.

A wallet address alone does not prove wallet ownership. Financial signing must use the intended managed-wallet/provider verification mechanism.

## Testnet warning

This guide is for Testnet only. Testnet success is not a security audit, regulatory approval, custody approval, or authorization to operate a real-money financial service.

Mainnet requires separately verified production token addresses, wallet/custody controls, monitoring, security review, legal/compliance preparation, and controlled pilot validation.
