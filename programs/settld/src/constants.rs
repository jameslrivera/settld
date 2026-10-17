use anchor_lang::prelude::*;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";
#[constant]
pub const CARD_SEED: &[u8] = b"card";
#[constant]
pub const MERCHANT_SEED: &[u8] = b"merchant";
#[constant]
pub const VAULT_SEED: &[u8] = b"vault";
#[constant]
pub const AGENT_SEED: &[u8] = b"agent";
#[constant]
pub const INTENT_SEED: &[u8] = b"intent";

pub const UID_LEN: usize = 7;

#[constant]
pub const SLOTS_PER_DAY: u64 = 216_000;

pub const ALL_MERCHANTS: u64 = u64::MAX;

pub const REASON_OK: u8 = 0;
pub const REASON_BLOCKED: u8 = 1;
pub const REASON_OVER_LIMIT: u8 = 2;
pub const REASON_HIGH_RISK: u8 = 3;
pub const REASON_INSUFFICIENT: u8 = 4;
pub const REASON_AGENT_FROZEN: u8 = 5;
pub const REASON_MERCHANT_NOT_ALLOWED: u8 = 6;
pub const REASON_OUTSIDE_WINDOW: u8 = 7;
pub const REASON_OVER_BUDGET: u8 = 8;
pub const REASON_NEEDS_APPROVAL: u8 = 9;
pub const REASON_TOO_MANY_PER_HOUR: u8 = 10;
pub const REASON_TASK_EXPIRED: u8 = 11;

pub const KIND_PERSON: u8 = 0;
pub const KIND_TASK: u8 = 1;

pub const AGENT_REGISTERED: u8 = 0;
pub const AGENT_POLICY_SET: u8 = 1;
pub const AGENT_FUNDED: u8 = 2;
pub const AGENT_CLAWBACK: u8 = 3;
pub const AGENT_FROZEN: u8 = 4;
pub const AGENT_UNFROZEN: u8 = 5;
pub const TASK_OPENED: u8 = 6;
pub const TASK_CLOSED: u8 = 7;
pub const INTENT_APPROVED: u8 = 8;
pub const INTENT_CLOSED: u8 = 9;
