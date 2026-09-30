# Stage 2 status — BNB Testnet

## Completed without a wallet
- BNB Smart Chain Solidity contract is in the repository.
- Hardhat compile and automated tests pass on the `bnb-app-complete` branch.
- Testnet deployment workflow is configured.
- Deployment script now verifies Chain ID 97, requires a funded testnet deployer, deploys the protocol and MockUSDT, and verifies the test token is allowlisted.
- Browser frontend is wired for BNB Testnet and EIP-1193 wallets.
- GitHub Pages workflow is present.

## Waiting for the user's dedicated testnet wallet
A wallet/private key is required only for the actual on-chain deployment. Do not put a real-money wallet private key in this project.

When the wallet is available:
1. Add the private key as GitHub Actions secret `DEPLOYER_PRIVATE_KEY`.
2. Fund that wallet with tBNB.
3. Run **Deploy Liholiswano to BNB Testnet**.
4. Copy the two resulting contract addresses into `web/config.js`.
5. Run the end-to-end three-wallet test.

## Current verification
The latest BNB compile/test workflow for commit `efd16e3f4ab7d5fe00c69c7a35d591d15199afbb` completed successfully.

The GitHub Pages run for the same commit failed. This does not indicate that the Solidity compile/tests failed; Pages deployment still needs to be configured/verified in the repository's Pages settings.

## Important
No BNB Testnet contract has been deployed yet. Therefore the frontend cannot honestly be called live/on-chain connected yet.

The MockUSDT is test-only and must never be used on BNB Mainnet.
