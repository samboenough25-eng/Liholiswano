# BNB next technical stage

## Verified

1. GitHub CI installs dependencies.
2. JavaScript syntax checks pass.
3. API syntax checks pass.
4. Solidity compilation passes.
5. Hardhat contract tests pass.
6. Local three-wallet ROSCA E2E passes.
7. Web static validation passes.
8. BNB Testnet deployment exists and is configured in the active app.
9. The PostgreSQL blockchain indexer has successfully connected to BSC Testnet
   and completed polling cycles without rate-limit errors.

## Immediate gate

Run the controlled BNB Testnet ROSCA E2E workflow after the deployer wallet
has enough tBNB to fund three temporary test members. The test must end with:

`TESTNET_E2E=PASS`

The test must verify create → join → collateral → contribution → bids →
settlement → winner payout → winner accounting.

## After E2E

10. Reconcile every emitted contract event against PostgreSQL.
11. Verify indexer restart/idempotency and reorg handling.
12. Connect and verify the intended managed-wallet provider.
13. Connect real WhatsApp Business credentials in a controlled environment.
14. Connect the intended KYC/biometric and AML/compliance providers.
15. Harden keeper automation, transaction tracking, retries, nonce management,
    confirmations and alerting.
16. Complete independent smart-contract/security review and adversarial testing.
17. Only then prepare a separate BNB Mainnet configuration and real stablecoin
    deployment.

Never commit a private key, seed phrase, API key or .env file.