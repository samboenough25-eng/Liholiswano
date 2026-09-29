# Liholiswano — BNB Smart Chain V1

This branch contains the BNB Smart Chain implementation of Liholiswano.

## Current stage

The local BNB package has been assembled with:
- Solidity LiholiswanoV1 contract
- Mock ERC-20 test token
- Hardhat configuration for BNB Testnet (chain 97) and BNB Mainnet (chain 56)
- Hardhat deployment script
- Automated test suite
- EVM wallet frontend target
- Express backend
- CI workflow

The source package is also available from the current ChatGPT conversation as `liholiswano-bnb-stages-1-6.zip`.

## Next gate

GitHub CI must successfully install dependencies, compile the Solidity contracts, and pass all tests before any BNB Testnet deployment.

Never commit private keys or `.env` files.
