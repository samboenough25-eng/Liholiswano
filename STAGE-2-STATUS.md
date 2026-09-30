# Stage 2 status — BNB Smart Chain Testnet

## Completed in code

- BNB Solidity protocol contract
- automatic full-group locking
- contract-enforced round deadlines
- permissionless deadline defaults and settlement triggering
- per-group escrow accounting
- reentrancy protection
- exact ERC-20 transfer checks
- two-step ownership transfer
- Hardhat unit tests
- local three-wallet E2E
- browser static validation
- manual BNB Testnet deployment workflow

## Still wallet-dependent

1. Create/use a dedicated BNB Testnet deployer wallet.
2. Fund it with tBNB.
3. Add its private key as the GitHub Actions secret DEPLOYER_PRIVATE_KEY.
4. Run Deploy Liholiswano to BNB Testnet.
5. Verify the resulting public contract addresses.
6. Configure the frontend.
7. Perform the real three-wallet Testnet lifecycle.

## Security

The active BNB contract is still unaudited. No automated-test result should be interpreted as approval for Mainnet or real-money use.