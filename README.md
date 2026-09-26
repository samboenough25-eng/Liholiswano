# Liholiswano Financial Services Platform

Liholiswano is a community rotating-savings platform. The current target architecture uses the Stellar/Soroban contract as the financial authority while the web application provides the user interface.

## Current live Testnet integration

The V2.2 Soroban contract has already been deployed and exercised on Stellar Testnet in the companion protocol repository:

- Contract: `CAGSH4W3EYKOBHV6TUZ2WMKHKMZP6NNID5PLERFEV2EG6TRZWBZRKLY`
- Test settlement token: `CAC2XTKZ527GSTTCVJWZNBDJLEDLNFCASGZ2CNQH6V3UCZYAGE5QASOU`
- Network: Stellar Testnet

The `web/index.html` application is configured for this deployed contract and uses Freighter for member authorization.

## Platform deployment

The repository now contains `.github/workflows/pages.yml`, which publishes `web/` as a GitHub Pages site whenever changes reach `main`.

The browser application supports the current V2.2 interface:

- Freighter connection
- group creation
- group locking
- joining
- waitlist
- waitlist promotion
- contributions
- compulsory bids
- round settlement
- admin default action
- completion refund
- group state and member dashboard
- approved-token inspection and protocol-admin token approval

## Security boundary

The website does not hold a Liholiswano treasury key. Member wallets authorize their own transactions and the Soroban contract enforces the financial rules.

The current browser screen uses one connected wallet for its administrative workflow, so it exposes threshold-1 group creation/locking/default actions. The underlying contract supports N-of-M multi-admin authorization, but a production interface needs independent wallet signatures rather than collecting other members' secret keys.

## Testnet only

This deployment is for technical testing and demonstration. It is not a production financial service.

Before Mainnet or real-money use, the project still needs wallet UX hardening, production indexing/read services, notifications, fiat/mobile-money rails, security review, operational monitoring, jurisdiction-specific legal/compliance work in Botswana and Eswatini, and controlled pilot validation. Testnet token addresses must never be assumed to be Mainnet addresses.
