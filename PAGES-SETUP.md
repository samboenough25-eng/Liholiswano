# GitHub Pages setup

The website workflow is already committed at `.github/workflows/pages.yml`.

If GitHub Pages has not been enabled for this repository, an owner must enable it once:

1. Open the repository on GitHub.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, select **GitHub Actions** as the source.
4. Save the setting.
5. Open **Actions** and run **Deploy Liholiswano Financial Services Platform** manually if a run is not triggered automatically.

The workflow publishes the `web/` directory.

## Important

GitHub Pages only hosts the browser files. It does not deploy the Solidity contracts and it does not create a wallet.

The frontend remains Testnet-only until a real BNB Testnet deployment has produced contract addresses and those addresses are configured in `web/config.js`.

Never put a private key or seed phrase in the website files.
