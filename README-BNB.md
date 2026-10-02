# Liholiswano — BNB Smart Chain

This is the active BNB Smart Chain implementation.

## Network

- Testnet: chain ID 97
- Mainnet: chain ID 56

BNB Smart Chain is EVM-compatible, so the application uses Solidity, Hardhat and standard EVM wallet tooling.

## Contract architecture

The smart contract is the financial authority. Group locking, contribution/bid deadlines, defaults, winner selection, payouts and rotation are contract-enforced. A keeper may trigger eligible transactions but cannot override contract rules.

Security hardening currently includes per-group escrow accounting, reentrancy protection, exact token-transfer checks, two-step ownership transfer, automatic full-group locking, and deadline-based permissionless settlement/default triggering.

## Testnet deployment

The current Testnet deployment is:

- Liholiswano: `0xe9b104260c940fAE26a73e4E9c952fD18fFd2014`
- MockUSDT: `0xb516a4a0ec39e3CBa5baDAE5524E05F43EB66C29`

MockUSDT is an unrestricted development token. It is not USDT or USDC and must never be used on Mainnet.

## Production gate

The contract remains unaudited. Passing CI or Testnet E2E is not equivalent to production safety. Independent smart-contract review, adversarial/economic testing, production indexing/reconciliation, wallet/custody controls, monitoring, and applicable Botswana/Eswatini compliance work remain required before real-money operation.
