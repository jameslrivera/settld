pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("BexCXNjkZWSdAoHMGXMEh421eFVbWJ1cUgAkS1iMG5BM");

#[program]
pub mod settld {
    use super::*;

    pub fn init_config(ctx: Context<InitConfig>, decline_bps: u16) -> Result<()> {
        instructions::init_config::handle_init_config(ctx, decline_bps)
    }

    pub fn register_card(ctx: Context<RegisterCard>, uid: [u8; UID_LEN], daily_limit: u64, owner: Pubkey) -> Result<()> {
        instructions::register_card::handle_register_card(ctx, uid, daily_limit, owner)
    }

    pub fn set_card_owner(ctx: Context<SetCardOwner>, uid: [u8; UID_LEN], owner: Pubkey) -> Result<()> {
        instructions::register_card::handle_set_card_owner(ctx, uid, owner)
    }

    pub fn register_merchant(ctx: Context<RegisterMerchant>, merchant_id: u16, category: u8) -> Result<()> {
        instructions::register_merchant::handle_register_merchant(ctx, merchant_id, category)
    }

    pub fn deposit(ctx: Context<Deposit>, uid: [u8; UID_LEN], amount: u64) -> Result<()> {
        instructions::deposit::handle_deposit(ctx, uid, amount)
    }

    pub fn pay(ctx: Context<Pay>, uid: [u8; UID_LEN], amount: u64, risk_bps: u16, merchant_id: u16, nonce: u64) -> Result<()> {
        instructions::pay::handle_pay(ctx, uid, amount, risk_bps, merchant_id, nonce)
    }

    pub fn authorize_batch<'info>(ctx: Context<'info, AuthorizeBatch<'info>>, nonce: u64, items: Vec<AuthItem>) -> Result<()> {
        instructions::authorize_batch::handle_authorize_batch(ctx, nonce, items)
    }

    pub fn settle(ctx: Context<Settle>, merchant_id: u16, amount: u64) -> Result<()> {
        instructions::settle::handle_settle(ctx, merchant_id, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, uid: [u8; UID_LEN], amount: u64) -> Result<()> {
        instructions::withdraw::handle_withdraw(ctx, uid, amount)
    }

    pub fn set_card_status(ctx: Context<SetCardStatus>, uid: [u8; UID_LEN], status: CardStatus) -> Result<()> {
        instructions::set_card_status::handle_set_card_status(ctx, uid, status)
    }

    pub fn set_merchant_agent_policy(ctx: Context<SetMerchantAgentPolicy>, merchant_id: u16, accepts_agents: bool, max_agent_ticket: u64) -> Result<()> {
        instructions::merchant_agent_policy::handle_set_merchant_agent_policy(ctx, merchant_id, accepts_agents, max_agent_ticket)
    }

    pub fn register_agent(ctx: Context<RegisterAgent>, owner: Pubkey, agent_id: u16, policy: AgentPolicy) -> Result<()> {
        instructions::register_agent::handle_register_agent(ctx, owner, agent_id, policy)
    }

    pub fn set_agent_policy(ctx: Context<SetAgentPolicy>, owner: Pubkey, agent_id: u16, policy: AgentPolicy) -> Result<()> {
        instructions::set_agent_policy::handle_set_agent_policy(ctx, owner, agent_id, policy)
    }

    pub fn fund_agent(ctx: Context<FundAgent>, uid: [u8; UID_LEN], owner: Pubkey, agent_id: u16, amount: u64) -> Result<()> {
        instructions::fund_agent::handle_fund_agent(ctx, uid, owner, agent_id, amount)
    }

    pub fn clawback(ctx: Context<FundAgent>, uid: [u8; UID_LEN], owner: Pubkey, agent_id: u16, amount: u64) -> Result<()> {
        instructions::fund_agent::handle_clawback(ctx, uid, owner, agent_id, amount)
    }

    pub fn open_task_card(ctx: Context<OpenTaskCard>, owner: Pubkey, agent_id: u16, uid: [u8; UID_LEN], budget: u64, merchant_mask: u64, expires_slot: u64) -> Result<()> {
        instructions::task_card::handle_open_task_card(ctx, owner, agent_id, uid, budget, merchant_mask, expires_slot)
    }

    pub fn close_task_card(ctx: Context<CloseTaskCard>, owner: Pubkey, agent_id: u16, uid: [u8; UID_LEN]) -> Result<()> {
        instructions::task_card::handle_close_task_card(ctx, owner, agent_id, uid)
    }

    pub fn approve_intent(ctx: Context<ApproveIntent>, owner: Pubkey, agent_id: u16, nonce: u64, merchant_id: u16, amount: u64, expires_slot: u64, approved_by: Pubkey) -> Result<()> {
        instructions::approve_intent::handle_approve_intent(ctx, owner, agent_id, nonce, merchant_id, amount, expires_slot, approved_by)
    }

    pub fn close_intent(ctx: Context<CloseIntent>, owner: Pubkey, agent_id: u16, nonce: u64) -> Result<()> {
        instructions::approve_intent::handle_close_intent(ctx, owner, agent_id, nonce)
    }

    pub fn set_agent_frozen(ctx: Context<SetAgentFrozen>, owner: Pubkey, agent_id: u16, frozen: bool) -> Result<()> {
        instructions::agent_frozen::handle_set_agent_frozen(ctx, owner, agent_id, frozen)
    }

    pub fn freeze_all<'info>(ctx: Context<'info, FreezeAll<'info>>, owner: Pubkey) -> Result<()> {
        instructions::agent_frozen::handle_freeze_all(ctx, owner)
    }

    pub fn pay_agent(ctx: Context<PayAgent>, uid: [u8; UID_LEN], amount: u64, risk_bps: u16, merchant_id: u16, nonce: u64) -> Result<()> {
        instructions::pay_agent::handle_pay_agent(ctx, uid, amount, risk_bps, merchant_id, nonce)
    }
}
