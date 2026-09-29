# Liholiswano BNB web app
This branch is the BNB Smart Chain implementation. It includes a Solidity contract, Hardhat tests, browser UI, Testnet configuration and CI.
## Test
npm ci
npm run compile
npm test
## Testnet
Set DEPLOYER_PRIVATE_KEY as a secret/environment variable and run npm run deploy:testnet. Never commit a private key.
## Browser
Serve web/ with a static server. After deploying, put the contract address and approved token address into web/config.js. The browser uses the wallet's EIP-1193 provider and never asks for seed phrases.
## Token model
The contract uses an ERC-20 allowlist so the same deployment can support USDT or USDC. Token decimals must match the selected token.
## Safety
This is a testnet implementation. Complete independent smart-contract/security review and test the full money flow before using real funds.