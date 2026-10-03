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
The repository's browser configuration is pinned to the current BNB Testnet deployment used by the dApp. Treat the deployment record and on-chain verification as the source of truth rather than copying addresses from older documentation.

- Chain: BNB Smart Chain Testnet (97)
- Protocol: `0x3b3272900EfdC7d9999969E3A0c64F8019fECeAf`
- MockUSDT: `0x0499B15F9378971E8e1700744821dBc969E90e04`
- Subscription contract: `0xE0132dDAD9f2bCBC8e7f3B63e1dAc029b3bB7cb5`
- Token symbol: mUSDT (6 decimals)
- Real USDT/USDC: not used on Testnet

MockUSDT is an unrestricted development token. It is not USDT or USDC and must never be used on Mainnet.

## Production gate

The contract remains unaudited. Passing CI or Testnet E2E is not equivalent to production safety. Independent smart-contract review, adversarial/economic testing, production indexing/reconciliation, wallet/custody controls, monitoring, and applicable Botswana/Eswatini compliance work remain required before real-money operation.


## Interface separation
- Customer dApp: `web/dapp.html`
- Owner/admin console: `web/owner.html`
- Customer account/operations dashboard: `web/dashboard.html`
- Customer and owner interfaces are intentionally separate.
- The owner console verifies the connected wallet against the protocol's on-chain owner before enabling privileged protocol controls.
