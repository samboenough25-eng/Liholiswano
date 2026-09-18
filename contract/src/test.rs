#![cfg(test)]

use super::*;
use soroban_sdk::testutils::{Address as _};
use soroban_sdk::{token, Env};

fn setup<'a>(env: &Env) -> (Address, token::Client<'a>, token::StellarAssetClient<'a>) {
    let admin = Address::generate(env);
    let sac = env.register_stellar_asset_contract(admin.clone());
    let token_client = token::Client::new(env, &sac);
    let asset_client = token::StellarAssetClient::new(env, &sac);
    (admin, token_client, asset_client)
}

fn deploy(env: &Env) -> Address {
    env.register_contract(None, LiholiswanoContract)
}

#[test]
fn create_join_lock_happy_path() {
    let env = Env::default();
    env.mock_all_auths();
    let (token_admin, token_client, asset_client) = setup(&env);
    let contract_id = deploy(&env);
    let client = LiholiswanoContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let m1 = Address::generate(&env);
    let m2 = Address::generate(&env);
    let m3 = Address::generate(&env);
    for m in [&admin, &m1, &m2, &m3] {
        asset_client.mint(m, &1_000);
    }
    let _ = token_admin; // just needed the SAC deployed under some admin

    let id = Symbol::new(&env, "grp1");
    client.create_group(&id, &admin, &token_client.address, &100, &500, &2000, &10);

    client.join_group(&id, &m1);
    client.join_group(&id, &m2);
    client.join_group(&id, &m3);

    let state = client.get_group_state(&id);
    assert_eq!(state.members.len(), 3);
    assert_eq!(token_client.balance(&contract_id), 1500); // 3 x 500 collateral

    client.lock_group(&id, &admin);
    let state = client.get_group_state(&id);
    assert!(state.locked);
    assert_eq!(state.round, 1);
}

#[test]
fn cannot_join_after_lock() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, token_client, asset_client) = setup(&env);
    let contract_id = deploy(&env);
    let client = LiholiswanoContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let m1 = Address::generate(&env);
    let m2 = Address::generate(&env);
    let m3 = Address::generate(&env);
    let latecomer = Address::generate(&env);
    for m in [&m1, &m2, &m3, &latecomer] {
        asset_client.mint(m, &1_000);
    }

    let id = Symbol::new(&env, "grp1");
    client.create_group(&id, &admin, &token_client.address, &100, &0, &2000, &10);
    client.join_group(&id, &m1);
    client.join_group(&id, &m2);
    client.join_group(&id, &m3);
    client.lock_group(&id, &admin);

    let res = client.try_join_group(&id, &latecomer);
    assert_eq!(res, Err(Ok(Error::AlreadyLocked)));
}

#[test]
fn cannot_join_full_group() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, token_client, asset_client) = setup(&env);
    let contract_id = deploy(&env);
    let client = LiholiswanoContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let id = Symbol::new(&env, "grp1");
    client.create_group(&id, &admin, &token_client.address, &100, &0, &2000, &3);

    let m1 = Address::generate(&env);
    let m2 = Address::generate(&env);
    let m3 = Address::generate(&env);
    let m4 = Address::generate(&env);
    for m in [&m1, &m2, &m3, &m4] {
        asset_client.mint(m, &1_000);
    }
    client.join_group(&id, &m1);
    client.join_group(&id, &m2);
    client.join_group(&id, &m3);

    let res = client.try_join_group(&id, &m4);
    assert_eq!(res, Err(Ok(Error::GroupFull)));
}

#[test]
fn cannot_lock_below_three_members() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, token_client, asset_client) = setup(&env);
    let contract_id = deploy(&env);
    let client = LiholiswanoContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let id = Symbol::new(&env, "grp1");
    client.create_group(&id, &admin, &token_client.address, &100, &0, &2000, &10);

    let m1 = Address::generate(&env);
    let m2 = Address::generate(&env);
    asset_client.mint(&m1, &1_000);
    asset_client.mint(&m2, &1_000);
    client.join_group(&id, &m1);
    client.join_group(&id, &m2);

    let res = client.try_lock_group(&id, &admin);
    assert_eq!(res, Err(Ok(Error::TooFewMembersToLock)));
}

#[test]
fn duplicate_join_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, token_client, asset_client) = setup(&env);
    let contract_id = deploy(&env);
    let client = LiholiswanoContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let id = Symbol::new(&env, "grp1");
    client.create_group(&id, &admin, &token_client.address, &100, &0, &2000, &10);

    let m1 = Address::generate(&env);
    asset_client.mint(&m1, &1_000);
    client.join_group(&id, &m1);

    let res = client.try_join_group(&id, &m1);
    assert_eq!(res, Err(Ok(Error::AlreadyMember)));
}

#[test]
fn non_admin_cannot_lock() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, token_client, asset_client) = setup(&env);
    let contract_id = deploy(&env);
    let client = LiholiswanoContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let stranger = Address::generate(&env);
    let id = Symbol::new(&env, "grp1");
    client.create_group(&id, &admin, &token_client.address, &100, &0, &2000, &10);

    let m1 = Address::generate(&env);
    let m2 = Address::generate(&env);
    let m3 = Address::generate(&env);
    for m in [&m1, &m2, &m3] {
        asset_client.mint(m, &1_000);
    }
    client.join_group(&id, &m1);
    client.join_group(&id, &m2);
    client.join_group(&id, &m3);

    let res = client.try_lock_group(&id, &stranger);
    assert_eq!(res, Err(Ok(Error::NotAdmin)));
}

#[test]
fn reading_unknown_group_fails() {
    let env = Env::default();
    let contract_id = deploy(&env);
    let client = LiholiswanoContractClient::new(&env, &contract_id);

    let id = Symbol::new(&env, "nope");
    let res = client.try_get_group_state(&id);
    assert_eq!(res, Err(Ok(Error::GroupNotFound)));
}

#[test]
fn bid_above_max_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, token_client, asset_client) = setup(&env);
    let contract_id = deploy(&env);
    let client = LiholiswanoContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let id = Symbol::new(&env, "grp1");
    client.create_group(&id, &admin, &token_client.address, &100, &0, &2000, &10); // max 20%

    let m1 = Address::generate(&env);
    let m2 = Address::generate(&env);
    let m3 = Address::generate(&env);
    for m in [&m1, &m2, &m3] {
        asset_client.mint(m, &1_000);
    }
    client.join_group(&id, &m1);
    client.join_group(&id, &m2);
    client.join_group(&id, &m3);
    client.lock_group(&id, &admin);

    let res = client.try_submit_bid(&id, &m1, &2500); // 25% > 20% max
    assert_eq!(res, Err(Ok(Error::BidTooHigh)));
}

/// End-to-end round: three members contribute, bid, settle — and every unit
/// of the token that entered the contract is accounted for on the other
/// side (winner payout + bonus shares + reserve). This is the on-chain
/// equivalent of the simulator's conservation check, using real balances
/// instead of an in-memory ledger.
#[test]
fn settle_round_conserves_value_with_uneven_split() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, token_client, asset_client) = setup(&env);
    let contract_id = deploy(&env);
    let client = LiholiswanoContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let id = Symbol::new(&env, "grp1");
    // contribution=100 units, 3 members -> pot=300. A 33% bid (3300 bps)
    // sacrifices floor(300*3300/10000) = 99, split between 2 others:
    // floor(99/2) = 49 each, 1 unit remainder to reserve. Deliberately
    // uneven so the floor+remainder rule is actually exercised.
    client.create_group(&id, &admin, &token_client.address, &100, &0, &5000, &10);

    let m1 = Address::generate(&env);
    let m2 = Address::generate(&env);
    let m3 = Address::generate(&env);
    for m in [&m1, &m2, &m3] {
        asset_client.mint(m, &1_000);
    }
    client.join_group(&id, &m1);
    client.join_group(&id, &m2);
    client.join_group(&id, &m3);
    client.lock_group(&id, &admin);

    client.contribute(&id, &m1);
    client.contribute(&id, &m2);
    client.contribute(&id, &m3);

    client.submit_bid(&id, &m1, &3300); // m1 will win with the highest bid
    client.submit_bid(&id, &m2, &0);
    client.submit_bid(&id, &m3, &0);

    let contract_balance_before = token_client.balance(&contract_id);
    assert_eq!(contract_balance_before, 300); // the pot, held in the contract

    client.settle_round(&id);

    let state = client.get_group_state(&id);
    // net_to_winner = 300 - 99 = 201; m2 and m3 each get 49; 1 unit -> reserve.
    assert_eq!(token_client.balance(&m1), 1_000 - 100 + 201);
    assert_eq!(token_client.balance(&m2), 1_000 - 100 + 49);
    assert_eq!(token_client.balance(&m3), 1_000 - 100 + 49);
    assert_eq!(state.reserve, 1);

    // Conservation: everything that left the contract (payout + bonuses)
    // plus what's still held (the reserve) equals what came in (the pot).
    let paid_out = 201 + 49 + 49;
    assert_eq!(paid_out + state.reserve, 300);
    assert_eq!(token_client.balance(&contract_id), state.reserve);
}

#[test]
fn default_seizes_collateral_and_logs_uncovered_shortfall() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, token_client, asset_client) = setup(&env);
    let contract_id = deploy(&env);
    let client = LiholiswanoContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let id = Symbol::new(&env, "grp1");
    // Deliberately thin collateral (1x contribution) so a post-win default
    // produces a real, provable uncovered shortfall rather than full cover.
    client.create_group(&id, &admin, &token_client.address, &100, &100, &2000, &10);

    let m1 = Address::generate(&env);
    let m2 = Address::generate(&env);
    let m3 = Address::generate(&env);
    for m in [&m1, &m2, &m3] {
        asset_client.mint(m, &1_000);
    }
    client.join_group(&id, &m1);
    client.join_group(&id, &m2);
    client.join_group(&id, &m3);
    client.lock_group(&id, &admin);

    client.contribute(&id, &m1);
    client.contribute(&id, &m2);
    client.contribute(&id, &m3);
    client.submit_bid(&id, &m1, &0);
    client.submit_bid(&id, &m2, &0);
    client.submit_bid(&id, &m3, &0);
    client.settle_round(&id); // m1 wins round 1 (first eligible, all bid 0)

    // m1 already won this rotation; m2 and m3 still haven't. m1 defaults
    // before paying round 2 -> still owes for m2 and m3's future rounds:
    // owed = 2 * 100 = 200, but collateral is only 100 -> 100 uncovered.
    client.mark_default(&id, &admin, &m1);

    let state = client.get_group_state(&id);
    assert_eq!(state.total_uncovered_shortfall, 100);
    let m1_state = client.get_member(&id, &m1);
    assert!(!m1_state.active);
    assert!(m1_state.defaulted);
}
