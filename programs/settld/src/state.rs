use anchor_lang::prelude::*;

use crate::{constants::UID_LEN, errors::SettldError};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum CardStatus {
    Active,
    Blocked,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum CardKind {
    Person,
    Task,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub issuer: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub decline_bps: u16,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Card {
    pub uid: [u8; UID_LEN],
    pub issuer: Pubkey,
    pub status: CardStatus,
    pub kind: CardKind,
    pub owner: Pubkey,
    pub balance: u64,
    pub daily_limit: u64,
    pub spent_today: u64,
    pub day_index: u64,
    pub merchant_mask: u64,
    pub expires_slot: u64,
    pub auth_count: u64,
    pub last_merchant: u16,
    pub last_slot: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Merchant {
    pub id: u16,
    pub category: u8,
    pub token_account: Pubkey,
    pub settled_total: u64,
    pub auth_count: u64,
    pub accepts_agents: bool,
    pub max_agent_ticket: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct AgentPolicy {
    pub budget_total: u64,
    pub per_txn_max: u64,
    pub daily_max: u64,
    pub merchant_mask: u64,
    pub hour_start: u8,
    pub hour_end: u8,
    pub approval_threshold: u64,
    pub max_txn_per_hour: u8,
}

impl AgentPolicy {
    pub fn validate(&self) -> Result<()> {
        require!(self.hour_start < 24 && self.hour_end < 24, SettldError::BadPolicy);
        Ok(())
    }

    pub fn hash(&self) -> Result<[u8; 32]> {
        let bytes = borsh::to_vec(self).map_err(|_| error!(SettldError::BadPolicy))?;
        Ok(solana_sha256_hasher::hash(&bytes).to_bytes())
    }
}

pub fn mask_allows(mask: u64, merchant_id: u16) -> bool {
    mask == u64::MAX || (merchant_id < 64 && mask & (1u64 << merchant_id) != 0)
}

pub fn in_hours(start: u8, end: u8, hour: u8) -> bool {
    if start == end {
        true
    } else if start < end {
        hour >= start && hour < end
    } else {
        hour >= start || hour < end
    }
}

#[account]
#[derive(InitSpace)]
pub struct Agent {
    pub owner: Pubkey,
    pub agent_id: u16,
    pub frozen: bool,
    pub balance: u64,
    pub policy: AgentPolicy,
    pub policy_version: u32,
    pub policy_hash: [u8; 32],
    pub spent_total: u64,
    pub spent_today: u64,
    pub day_index: u64,
    pub txn_this_hour: u8,
    pub hour_index: u64,
    pub open_tasks: u16,
    pub auth_count: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Intent {
    pub agent: Pubkey,
    pub nonce: u64,
    pub merchant_id: u16,
    pub amount: u64,
    pub expires_slot: u64,
    pub approved_by: Pubkey,
    pub used: bool,
    pub bump: u8,
}

#[event]
pub struct AuthEvent {
    pub uid: [u8; UID_LEN],
    pub merchant_id: u16,
    pub amount: u64,
    pub risk_bps: u16,
    pub approved: bool,
    pub reason: u8,
    pub settled: bool,
    pub kind: u8,
    pub agent_id: u16,
    pub agent: Pubkey,
    pub intent_used: bool,
    pub slot: u64,
    pub nonce: u64,
}

#[event]
pub struct AgentEvent {
    pub agent: Pubkey,
    pub owner: Pubkey,
    pub agent_id: u16,
    pub action: u8,
    pub amount: u64,
    pub uid: [u8; UID_LEN],
    pub nonce: u64,
    pub policy_hash: [u8; 32],
    pub policy_version: u32,
    pub policy: AgentPolicy,
    pub slot: u64,
}

#[event]
pub struct CardEvent {
    pub uid: [u8; UID_LEN],
    pub owner: Pubkey,
    pub kind: u8,
    pub daily_limit: u64,
    pub slot: u64,
}

#[event]
pub struct MerchantEvent {
    pub merchant_id: u16,
    pub category: u8,
    pub token_account: Pubkey,
    pub accepts_agents: bool,
    pub max_agent_ticket: u64,
    pub slot: u64,
}

#[event]
pub struct SettleEvent {
    pub merchant_id: u16,
    pub amount: u64,
    pub slot: u64,
}

#[event]
pub struct DepositEvent {
    pub uid: [u8; UID_LEN],
    pub amount: u64,
    pub balance: u64,
    pub slot: u64,
}

#[event]
pub struct WithdrawEvent {
    pub uid: [u8; UID_LEN],
    pub amount: u64,
    pub balance: u64,
    pub slot: u64,
}

#[event]
pub struct StatusEvent {
    pub uid: [u8; UID_LEN],
    pub status: CardStatus,
    pub slot: u64,
}
