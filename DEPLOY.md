# Deploying the Liholiswano contract to Stellar Testnet

None of these steps have been run by me (no network access to Stellar from
this environment, no wasm32 target available — see PILOT_SCOPE.md). This is
a standard Soroban deployment sequence; follow the official docs at
https://developers.stellar.org/docs if anything here looks stale.

## 1. Install the toolchain (on your own machine)

```bash
# Rust, if you don't already have it
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown

# Soroban CLI
cargo install --locked soroban-cli
```

## 2. Build the contract

```bash
cd contract
cargo test          # confirm all 10 tests still pass on your machine
soroban contract build
# produces target/wasm32-unknown-unknown/release/liholiswano_contract.wasm
```

## 3. Fund a Testnet identity

```bash
soroban keys generate admin --network testnet
soroban keys fund admin --network testnet
```

## 4. Get or create a Testnet token

For a pilot, the simplest option is Stellar's native asset wrapped as a
Stellar Asset Contract (SAC) — this gives you a real Soroban token interface
backed by testnet XLM:

```bash
soroban contract asset deploy \
  --asset native \
  --network testnet \
  --source admin
```

This prints a token contract ID — save it, you'll need it both for
deployment and for the frontend config.

If you'd rather use a custom pilot token (so contribution amounts aren't
tied to XLM's price), issue your own Stellar classic asset first via the
Stellar CLI or Laboratory, then wrap that asset the same way with
`soroban contract asset deploy --asset <CODE>:<ISSUER>`.

## 5. Deploy the contract

```bash
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/liholiswano_contract.wasm \
  --network testnet \
  --source admin
```

This prints the deployed contract's ID (starts with `C...`). That's what
goes in the frontend's "Contract ID" field.

## 6. Configure the frontend

Open `web/pilot-onchain.html`, connect Freighter (set to Testnet in the
extension), and fill in:
- **Contract ID** — from step 5
- **Token contract ID** — from step 4
- **RPC URL** — `https://soroban-testnet.stellar.org` (default)
- **Network passphrase** — `Test SDF Network ; September 2015` (default)

## 7. Walk through one full cycle before inviting anyone

1. Admin: **Create group**.
2. 3+ members (each with Freighter connected to their own funded testnet
   account): **Join group**. Confirm collateral actually leaves their
   balance and lands in the contract (check on
   https://stellar.expert/explorer/testnet).
3. Admin: **Lock group**.
4. Every member: **Contribute this round**, then **Submit bid**.
5. Anyone: **Settle round** — confirm the winner's balance increases by
   the expected net amount, and bonus shares land correctly on the others.
6. Deliberately let one member miss a round, then admin: **Mark default**
   — confirm collateral is seized and, if applicable, an uncovered
   shortfall shows up in the group state.

Only after all of that behaves as expected on Testnet would this be
reasonable to discuss moving toward Mainnet — and that jump deserves its
own separate security review, not just "it worked in the pilot."
