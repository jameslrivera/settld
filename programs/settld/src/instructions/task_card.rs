use anchor_lang::prelude::*;

use crate::{constants::*, errors::SettldError, state::*};

#[derive(Accounts)]
#[instruction(owner: Pubkey, agent_id: u16, uid: [u8; UID_LEN])]
pub struct OpenTaskCard<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = issuer)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [AGENT_SEED, owner.as_ref(), &agent_id.to_le_bytes()], bump = agent.bump)]
    pub agent: Account<'info, Agent>,
    #[account(
        init,
        payer = issuer,
        space = 8 + Card::INIT_SPACE,
        seeds = [CARD_SEED, uid.as_ref()],
        bump
    )]
    pub card: Account<'info, Card>,
    pub system_program: Program<'info, System>,
}

pub fn handle_open_task_card(ctx: Context<OpenTaskCard>, owner: Pubkey, agent_id: u16, uid: [u8; UID_LEN], budget: u64, merchant_mask: u64, expires_slot: u64) -> Result<()> {
    let agent = &mut ctx.accounts.agent;
    require!(!agent.frozen, SettldError::AgentIsFrozen);
    require!(agent.balance >= budget, SettldError::InsufficientAgentBalance);
    agent.balance -= budget;
    agent.open_tasks = agent.open_tasks.saturating_add(1);

    let slot = Clock::get()?.slot;
    let card = &mut ctx.accounts.card;
    card.uid = uid;
    card.issuer = ctx.accounts.issuer.key();
    card.status = CardStatus::Active;
    card.kind = CardKind::Task;
    card.owner = agent.key();
    card.balance = budget;
    card.daily_limit = budget;
    card.spent_today = 0;
    card.day_index = slot / SLOTS_PER_DAY;
    card.merchant_mask = merchant_mask;
    card.expires_slot = expires_slot;
    card.auth_count = 0;
    card.last_merchant = 0;
    card.last_slot = 0;
    card.bump = ctx.bumps.card;

    emit!(AgentEvent {
        agent: agent.key(),
        owner,
        agent_id,
        action: TASK_OPENED,
        amount: budget,
        uid,
        nonce: 0,
        policy_hash: agent.policy_hash,
        policy_version: agent.policy_version,
        policy: agent.policy,
        slot,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(owner: Pubkey, agent_id: u16, uid: [u8; UID_LEN])]
pub struct CloseTaskCard<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = issuer)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [AGENT_SEED, owner.as_ref(), &agent_id.to_le_bytes()], bump = agent.bump)]
    pub agent: Account<'info, Agent>,
    #[account(
        mut,
        close = issuer,
        seeds = [CARD_SEED, uid.as_ref()],
        bump = card.bump,
        constraint = card.kind == CardKind::Task @ SettldError::WrongCardKind,
        constraint = card.owner == agent.key() @ SettldError::NotOwner,
    )]
    pub card: Account<'info, Card>,
}

pub fn handle_close_task_card(ctx: Context<CloseTaskCard>, owner: Pubkey, agent_id: u16, uid: [u8; UID_LEN]) -> Result<()> {
    let agent = &mut ctx.accounts.agent;
    let left = ctx.accounts.card.balance;
    agent.balance = agent.balance.checked_add(left).ok_or(SettldError::Overflow)?;
    agent.open_tasks = agent.open_tasks.saturating_sub(1);
    emit!(AgentEvent {
        agent: agent.key(),
        owner,
        agent_id,
        action: TASK_CLOSED,
        amount: left,
        uid,
        nonce: 0,
        policy_hash: agent.policy_hash,
        policy_version: agent.policy_version,
        policy: agent.policy,
        slot: Clock::get()?.slot,
    });
    Ok(())
}
