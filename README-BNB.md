# Liholiswano — BNB Smart Chain

This branch contains the BNB Smart Chain implementation of Liholiswano.

## Stage 1 complete
- Solidity 0.8.24 protocol contract.
- Hardhat compile and automated tests.
- ERC-20 token allowlist.
- Browser application using ethers v6.
- EVM wallet compatibility, including wallets exposing an EIP-1193 provider.

## Stage 2 — BNB Testnet deployment
The deployment workflow deploys two contracts to BNB Smart Chain Testnet:
1. Liholiswano protocol.
2. MockUSDT test token with 6 decimals and an initial test supply for the deployer.

The deployment script also allowlists the MockUSDT token in the protocol.

### GitHub secret
Create repository secret:
- `DEPLOYER_PRIVATE_KEY`: a dedicated BNB Testnet wallet private key.

Optional:
- `BSC_TESTNET_RPC_URL`: an alternative BNB Testnet RPC endpoint.

Never commit a private key, seed phrase, or production wallet credentials.

### Run deployment
GitHub → Actions → **Deploy Liholiswano to BNB Testnet** → **Run workflow** → branch `bnb-app-complete`.

The workflow first compiles and tests, then deploys. It uploads `deployment.txt` as artifact `bnb-testnet-deployment`.

### Connect the web app
After deployment, copy these values from `deployment.txt`:
- `LIHOLISWANO_CONTRACT`
- `TEST_TOKEN_CONTRACT`

Put them into `web/config.js` as `contractAddress` and `tokenAddress`.

The browser then supports:
- connect EVM wallet
- switch to BNB Testnet
- token balance and allowance
- token approval
- protocol token allowlisting by owner
- create group
- join group
- lock group
- contribute
- submit bid
- settle round
- mark default
- view on-chain group/member state

## Testnet sequence
For a three-member test:
1. Wallet A deploys / owns the protocol and creates a group.
2. Wallet A allowlists the MockUSDT (already done by deployment script).
3. Wallets A, B and C receive test tokens.
4. Each wallet approves collateral.
5. Each joins.
6. Admin locks the group.
7. Each approves and contributes.
8. Each submits a bid.
9. Any account settles after all active members have contributed and submitted bids.
10. Inspect balances and events on BscScan.

## Important
The current MockUSDT is intentionally a test token and its mint function is unrestricted. Do not use it on BNB Mainnet.

The Liholiswano contract is a prototype and has not been independently audited. Passing automated tests is not equivalent to security or economic-model approval. Real-money production requires further security review, operational controls, compliance/legal review, and a controlled pilot.
