# Liholiswano BNB Testnet Pilot Deployment

## Current pilot model

- Chain: BNB Smart Chain Testnet (chain ID 97)
- KYC provider integrations: intentionally disabled for the pilot
- Pilot identity verification: WhatsApp-first verification
- WhatsApp verification is a limited testnet onboarding control, not regulated production KYC
- Wallet control: customer signs a wallet-ownership message with a BNB-compatible wallet
- Financial authorization: customer wallet signs the actual smart-contract transaction
- Liholiswano does not receive seed phrases or private keys
- Subscription charging: disabled during the current Testnet validation cycle

## Render services

- API: https://liholiswano-bnb-api.onrender.com
- Web: https://liholiswano-bnb-web.onrender.com

## GitHub Actions secrets required for fresh Testnet deployment

Repository: samboenough25-eng/Liholiswano

Set these in GitHub repository Settings → Secrets and variables → Actions → Repository secrets:

1. DEPLOYER_PRIVATE_KEY
2. BSC_TESTNET_RPC_URL

Optional repository variable:
3. SUBSCRIPTION_TREASURY_ADDRESS

The private key must belong to a dedicated Testnet deployer wallet. Never put a private key in source code, Render frontend variables, WhatsApp messages, or this document.

## Fresh deployment workflow

Run: Actions → BNB Testnet Deploy and Full E2E → Run workflow

The workflow checks chain 97, compiles the contracts, deploys a fresh Liholiswano protocol contract, MockUSDT test token and subscription vault, then runs the full ROSCA Testnet E2E.

The workflow does not automatically change Render contract-address variables.

After a successful deployment, copy these three addresses from the workflow summary:

- LIHOLISWANO_CONTRACT
- TEST_TOKEN_CONTRACT
- SUBSCRIPTION_CONTRACT

Set them on the BNB API Render service as:

- BNB_CONTRACT_ADDRESS
- TEST_TOKEN_CONTRACT
- SUBSCRIPTION_CONTRACT_ADDRESS

Keep SUBSCRIPTIONS_ENABLED=false until subscription charging has been separately validated.

## Customer Testnet flow

1. Register on the web app.
2. Sign in.
3. Link a Botswana (+267) or Eswatini (+268) WhatsApp number.
4. Receive the one-time linking code.
5. Send LINK followed by the 6-digit code to the Liholiswano WhatsApp number.
6. Send VERIFY.
7. Complete the WhatsApp pilot verification conversation.
8. Open the dashboard and verify ownership of a BNB Testnet wallet.
9. Use an available ROSCA group.
10. WhatsApp can prepare the financial request.
11. The secure authorization page asks the customer wallet to sign the transaction.
12. The API accepts the transaction only after checking the sender, target, chain, calldata, receipt and required token transfer.
13. The blockchain remains the authoritative financial controller.

## Production gate

Mainnet must not use the WhatsApp pilot verification as regulated KYC. Production requires the real KYC/AML/compliance providers, production BSC contract and production stablecoin, dedicated RPC, security review/audit, operational controls, and jurisdiction-specific compliance work.