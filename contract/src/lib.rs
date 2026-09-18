//! Liholiswano Protocol V2 — Soroban contract, pilot scope.
//!
//! Implements the core rotation/bidding/collateral/default rules from the
//! frozen spec, using real token transfers (not internal bookkeeping) so a
//! pilot group's funds genuinely move on-chain. This is intentionally a
//! SUBSET of the full spec's 28-day-epoch state machine — see PILOT_SCOPE.md
//! for exactly what's implemented vs. deferred, and why.
//!
//! Money-safety rules carried over from the validated simulation engine:
//! - Bid sacrifice splits use integer division (floor); any remainder goes
//!   to the group's reserve, never invented, never dropped.
//! - A defaulting member's seized collateral covers what they still owe;
//!   any amount beyond that is logged as an explicit uncovered shortfall
//!   (bad debt), never fabricated from the reserve or from other members.

#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, Env, Symbol, Vec,
};

// ── Errors ──────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    GroupAlreadyExists = 1,
    GroupNotFound = 2,
    NotAdmin = 3,
    AlreadyLocked = 4,
    NotLocked = 5,
    GroupFull = 6,
    AlreadyMember = 7,
    NotAMember = 8,
    TooFewMembersToLock = 9,
    BidTooHigh = 10,
    AlreadyBidThisRound = 11,
    AlreadyContributedThisRound = 12,
    NotAllContributed = 13,
    NotAllBid = 14,
    MemberNotActive = 15,
    MemberAlreadyDefaulted = 16,
    NothingToSettle = 17,
    InvalidConfig = 18,
    NotEligibleThisRotation = 19,
}

// ── Storage types ───────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct GroupConfig {
    pub admin: Address,
    pub token: Address,          // the asset this group contributes/pays out in
    pub contribution: i128,      // per member, per round, in the token's base units
    pub collateral: i128,        // flat collateral required to join
    pub max_bid_bps: u32,        // max bid, in basis points of the pot (2000 = 20%)
    pub max_members: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Member {
    pub addr: Address,
    pub active: bool,
    pub defaulted: bool,
    pub won_this_rotation: bool,
    pub contributed_this_round: bool,
    pub bid_bps: i32,           // -1 = no bid submitted yet this round
    pub total_wins: u32,
    pub total_contributed: i128,
    pub total_received: i128,   // net payouts + bonuses, for the member's own dashboard
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct GroupState {
    pub config: GroupConfig,
    pub members: Vec<Member>,
    pub locked: bool,
    pub round: u32,
    pub rotation: u32,
    pub reserve: i128,
    pub total_uncovered_shortfall: i128, // running bad-debt tally, always visible on-chain
}

#[contracttype]
pub enum DataKey {
    Group(Symbol), // group id -> GroupState
}

fn get_group(env: &Env, id: &Symbol) -> Result<GroupState, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Group(id.clone()))
        .ok_or(Error::GroupNotFound)
}

fn put_group(env: &Env, id: &Symbol, state: &GroupState) {
    env.storage()
        .persistent()
        .set(&DataKey::Group(id.clone()), state);
}

fn find_member_idx(members: &Vec<Member>, addr: &Address) -> Option<u32> {
    for i in 0..members.len() {
        if members.get(i).unwrap().addr == *addr {
            return Some(i);
        }
    }
    None
}

fn active_count(members: &Vec<Member>) -> u32 {
    let mut n = 0;
    for i in 0..members.len() {
        if members.get(i).unwrap().active {
            n += 1;
        }
    }
    n
}

// ── Contract ────────────────────────────────────────────────────────────

#[contract]
pub struct LiholiswanoContract;

#[contractimpl]
impl LiholiswanoContract {
    /// Create a new group. `id` must not already exist. The creator becomes
    /// admin (the only address that can lock the group and mark defaults —
    /// mirrors the pilot's PIN-holder role, not a fully trustless design).
    pub fn create_group(
        env: Env,
        id: Symbol,
        admin: Address,
        token: Address,
        contribution: i128,
        collateral: i128,
        max_bid_bps: u32,
        max_members: u32,
    ) -> Result<(), Error> {
        admin.require_auth();

        if env.storage().persistent().has(&DataKey::Group(id.clone())) {
            return Err(Error::GroupAlreadyExists);
        }
        if contribution <= 0 || collateral < 0 || max_bid_bps > 5000 || max_members < 3 {
            return Err(Error::InvalidConfig);
        }

        let state = GroupState {
            config: GroupConfig {
                admin,
                token,
                contribution,
                collateral,
                max_bid_bps,
                max_members,
            },
            members: Vec::new(&env),
            locked: false,
            round: 0,
            rotation: 0,
            reserve: 0,
            total_uncovered_shortfall: 0,
        };
        put_group(&env, &id, &state);
        Ok(())
    }

    /// Join an unlocked group, posting collateral via a real token transfer
    /// from the member to the contract.
    pub fn join_group(env: Env, id: Symbol, member: Address) -> Result<(), Error> {
        member.require_auth();
        let mut state = get_group(&env, &id)?;

        if state.locked {
            return Err(Error::AlreadyLocked);
        }
        if state.members.len() >= state.config.max_members {
            return Err(Error::GroupFull);
        }
        if find_member_idx(&state.members, &member).is_some() {
            return Err(Error::AlreadyMember);
        }

        if state.config.collateral > 0 {
            let token_client = token::Client::new(&env, &state.config.token);
            token_client.transfer(
                &member,
                &env.current_contract_address(),
                &state.config.collateral,
            );
        }

        state.members.push_back(Member {
            addr: member,
            active: true,
            defaulted: false,
            won_this_rotation: false,
            contributed_this_round: false,
            bid_bps: -1,
            total_wins: 0,
            total_contributed: 0,
            total_received: 0,
        });
        put_group(&env, &id, &state);
        Ok(())
    }

    /// Admin-only: lock the group (no more joins) and start round 1.
    /// Requires at least 3 members, matching the spec's minimum viable group.
    pub fn lock_group(env: Env, id: Symbol, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        let mut state = get_group(&env, &id)?;

        if admin != state.config.admin {
            return Err(Error::NotAdmin);
        }
        if state.locked {
            return Err(Error::AlreadyLocked);
        }
        if state.members.len() < 3 {
            return Err(Error::TooFewMembersToLock);
        }

        state.locked = true;
        state.round = 1;
        state.rotation = 1;
        put_group(&env, &id, &state);
        Ok(())
    }

    /// A member pays this round's contribution via real token transfer.
    pub fn contribute(env: Env, id: Symbol, member: Address) -> Result<(), Error> {
        member.require_auth();
        let mut state = get_group(&env, &id)?;

        if !state.locked {
            return Err(Error::NotLocked);
        }
        let idx = find_member_idx(&state.members, &member).ok_or(Error::NotAMember)?;
        let mut m = state.members.get(idx).unwrap();
        if !m.active {
            return Err(Error::MemberNotActive);
        }
        if m.contributed_this_round {
            return Err(Error::AlreadyContributedThisRound);
        }

        let token_client = token::Client::new(&env, &state.config.token);
        token_client.transfer(
            &member,
            &env.current_contract_address(),
            &state.config.contribution,
        );

        m.contributed_this_round = true;
        m.total_contributed += state.config.contribution;
        state.members.set(idx, m);
        put_group(&env, &id, &state);
        Ok(())
    }

    /// A member submits their compulsory bid, in basis points of the pot
    /// (0 is a valid, and common, bid). Only eligible members (active, not
    /// already won this rotation) may bid.
    pub fn submit_bid(env: Env, id: Symbol, member: Address, bid_bps: u32) -> Result<(), Error> {
        member.require_auth();
        let mut state = get_group(&env, &id)?;

        if !state.locked {
            return Err(Error::NotLocked);
        }
        if bid_bps > state.config.max_bid_bps {
            return Err(Error::BidTooHigh);
        }
        let idx = find_member_idx(&state.members, &member).ok_or(Error::NotAMember)?;
        let mut m = state.members.get(idx).unwrap();
        if !m.active {
            return Err(Error::MemberNotActive);
        }
        if m.won_this_rotation {
            return Err(Error::NotEligibleThisRotation);
        }
        if m.bid_bps >= 0 {
            return Err(Error::AlreadyBidThisRound);
        }

        m.bid_bps = bid_bps as i32;
        state.members.set(idx, m);
        put_group(&env, &id, &state);
        Ok(())
    }

    /// Settle the round once every active member has contributed and every
    /// eligible member has bid. Pays the winner via token transfer, splits
    /// the bid sacrifice as a bonus to every other active member (floored,
    /// remainder to reserve — the exact rule validated in the simulator),
    /// advances the round, and resets for the next rotation if this one just
    /// completed.
    pub fn settle_round(env: Env, id: Symbol) -> Result<(), Error> {
        let mut state = get_group(&env, &id)?;
        if !state.locked {
            return Err(Error::NotLocked);
        }

        let n_active = active_count(&state.members);
        if n_active == 0 {
            return Err(Error::NothingToSettle);
        }

        // Every active member must have contributed this round.
        for i in 0..state.members.len() {
            let m = state.members.get(i).unwrap();
            if m.active && !m.contributed_this_round {
                return Err(Error::NotAllContributed);
            }
        }

        // Every eligible (active, not-yet-won-this-rotation) member must have bid.
        let mut eligible_idxs: Vec<u32> = Vec::new(&env);
        for i in 0..state.members.len() {
            let m = state.members.get(i).unwrap();
            if m.active && !m.won_this_rotation {
                if m.bid_bps < 0 {
                    return Err(Error::NotAllBid);
                }
                eligible_idxs.push_back(i);
            }
        }

        // If nobody was eligible, the rotation just completed — reset and
        // treat every active member as freshly eligible for the new one.
        if eligible_idxs.len() == 0 {
            for i in 0..state.members.len() {
                let mut m = state.members.get(i).unwrap();
                if m.active {
                    m.won_this_rotation = false;
                    state.members.set(i, m);
                }
            }
            state.rotation += 1;
            for i in 0..state.members.len() {
                let m = state.members.get(i).unwrap();
                if m.active {
                    if m.bid_bps < 0 {
                        return Err(Error::NotAllBid);
                    }
                    eligible_idxs.push_back(i);
                }
            }
        }

        // Winner = highest bid; ties broken by lowest member index (stable,
        // matches the simulator's tie-break rule so results are comparable).
        let mut winner_pos = eligible_idxs.get(0).unwrap();
        let mut winner_bid = state.members.get(winner_pos).unwrap().bid_bps;
        for k in 1..eligible_idxs.len() {
            let idx = eligible_idxs.get(k).unwrap();
            let bid = state.members.get(idx).unwrap().bid_bps;
            if bid > winner_bid {
                winner_bid = bid;
                winner_pos = idx;
            }
        }

        let pot: i128 = (n_active as i128) * state.config.contribution;
        let bid_amount: i128 = (pot * (winner_bid as i128)) / 10_000;
        let net_to_winner: i128 = pot - bid_amount;

        let others_count: i128 = (n_active as i128) - 1;
        let share: i128 = if others_count > 0 { bid_amount / others_count } else { 0 };
        let remainder: i128 = bid_amount - share * others_count;

        let token_client = token::Client::new(&env, &state.config.token);
        let winner_addr = state.members.get(winner_pos).unwrap().addr.clone();
        if net_to_winner > 0 {
            token_client.transfer(&env.current_contract_address(), &winner_addr, &net_to_winner);
        }

        for i in 0..state.members.len() {
            let mut m = state.members.get(i).unwrap();
            if !m.active {
                continue;
            }
            if i == winner_pos {
                m.won_this_rotation = true;
                m.total_wins += 1;
                m.total_received += net_to_winner;
            } else if share > 0 {
                token_client.transfer(&env.current_contract_address(), &m.addr, &share);
                m.total_received += share;
            }
            // Reset per-round flags for the next round.
            m.contributed_this_round = false;
            m.bid_bps = -1;
            state.members.set(i, m);
        }

        state.reserve += remainder;
        state.round += 1;
        put_group(&env, &id, &state);
        Ok(())
    }

    /// Admin-only: mark a member as defaulted (didn't contribute by the
    /// deadline). Seizes their collateral into the reserve; if they'd
    /// already won this rotation and still owe future contributions, covers
    /// as much as collateral allows and logs any uncovered amount as bad
    /// debt — never fabricated from the reserve or other members.
    pub fn mark_default(env: Env, id: Symbol, admin: Address, member: Address) -> Result<(), Error> {
        admin.require_auth();
        let mut state = get_group(&env, &id)?;

        if admin != state.config.admin {
            return Err(Error::NotAdmin);
        }
        let idx = find_member_idx(&state.members, &member).ok_or(Error::NotAMember)?;
        let mut m = state.members.get(idx).unwrap();
        if m.defaulted {
            return Err(Error::MemberAlreadyDefaulted);
        }

        let collateral = state.config.collateral;
        let mut uncovered: i128 = 0;

        if m.won_this_rotation {
            let mut still_to_win: i128 = 0;
            for i in 0..state.members.len() {
                let other = state.members.get(i).unwrap();
                if other.active && !other.won_this_rotation && other.addr != member {
                    still_to_win += 1;
                }
            }
            let owed = still_to_win * state.config.contribution;
            let covered = if owed < collateral { owed } else { collateral };
            uncovered = owed - covered;
        }

        m.active = false;
        m.defaulted = true;
        state.members.set(idx, m);
        state.reserve += collateral; // full seized collateral enters the reserve
        state.total_uncovered_shortfall += uncovered; // only the true gap is ever logged as bad debt

        put_group(&env, &id, &state);
        Ok(())
    }

    // ── Read-only views ───────────────────────────────────────────────

    pub fn get_group_state(env: Env, id: Symbol) -> Result<GroupState, Error> {
        get_group(&env, &id)
    }

    pub fn get_member(env: Env, id: Symbol, member: Address) -> Result<Member, Error> {
        let state = get_group(&env, &id)?;
        let idx = find_member_idx(&state.members, &member).ok_or(Error::NotAMember)?;
        Ok(state.members.get(idx).unwrap())
    }
}

mod test;
