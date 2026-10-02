# Liholiswano BNB Smart Chain deployment

This is the active deployment guide for the `bnb-app-complete` branch.

## Network

- BNB Smart Chain Testnet
- Chain ID 97
- Native gas token: tBNB

## Validation

Run:

```bash
npm install
npm run check:all
```

The same core checks run in CI before deployment.

## Testnet deployment

Use `.github/workflows/deploy-bnb-testnet.yml`.

The workflow deploys:
1. Liholiswano
2. MockUSDT
3. MockUSDT approval in Liholiswano

The workflow records public deployment addresses as an artifact.

## Verify the deployment

Confirm:
- chain ID is 97
- Liholiswano contains contract code
- MockUSDT contains contract code
- MockUSDT is approved
- the intended deployer is the contract owner
- only Testnet assets are being used

## Configure the API

```text
BSC_CHAIN_ID=97
BSC_TESTNET_RPC_URL=<verified BNB Testnet RPC>
BNB_CONTRACT_ADDRESS=<verified Liholiswano address>
```

## Configure the indexer

```text
INDEXER_CONFIRMATIONS=3
INDEXER_MAX_BLOCK_RANGE=100
INDEXER_INITIAL_LOOKBACK=5000
INDEXER_START_BLOCK=<deployment block>
INDEXER_INTERVAL_MS=15000
```

A small block range is intentional for the public BNB Testnet RPC. For production, use a dedicated RPC provider and a provider architecture suitable for continuous `eth_getLogs` traffic.

## Database

Before indexing, verify that the database contains:
- indexer_state
- chain_events
- reconciliation_runs
- transaction_requests

## Complete Testnet lifecycle

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

A wallet address alone does not prove wallet ownership. Financial signing must use the intended wallet/provider verification mechanism.

Testnet success is not a security audit, regulatory approval, custody approval, or authorization for real-money operation.
