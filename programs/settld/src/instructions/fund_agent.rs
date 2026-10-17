use anchor_lang::prelude::*;

use crate::{constants::*, errors::SettldError, state::*};

#[derive(Accounts)]
#[instruction(uid: [u8; UID_LEN], owner: Pubkey, agent_id: u16)]
pub struct FundAgent<'info> {
    pub issuer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = issuer)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [CARD_SEED, uid.as_ref()],
        bump = card.bump,
        constraint = card.kind == CardKind::Person @ SettldError::WrongCardKind,
        constraint = card.owner == owner @ SettldError::NotOwner,
    )]
    pub card: Account<'info, Card>,
    #[account(mut, seeds = [AGENT_SEED, owner.as_ref(), &agent_id.to_le_bytes()], bump = agent.bump)]
    pub agent: Account<'info, Agent>,
}

pub fn handle_fund_agent(ctx: Context<FundAgent>, uid: [u8; UID_LEN], owner: Pubkey, agent_id: u16, amount: u64) -> Result<()> {
    let card = &mut ctx.accounts.card;
    let agent = &mut ctx.accounts.agent;
    require!(card.status == CardStatus::Active, SettldError::CardBlocked);
    require!(card.balance >= amount, SettldError::InsufficientBalance);
    card.balance -= amount;
    agent.balance = agent.balance.checked_add(amount).ok_or(SettldError::Overflow)?;
    emit!(AgentEvent {
        agent: agent.key(),
        owner,
        agent_id,
        action: AGENT_FUNDED,
        amount,
        uid,
        nonce: 0,
        policy_hash: agent.policy_hash,
        policy_version: agent.policy_version,
        policy: agent.policy,
        slot: Clock::get()?.slot,
    });
    Ok(())
}

pub fn handle_clawback(ctx: Context<FundAgent>, uid: [u8; UID_LEN], owner: Pubkey, agent_id: u16, amount: u64) -> Result<()> {
    let card = &mut ctx.accounts.card;
    let agent = &mut ctx.accounts.agent;
    require!(agent.balance >= amount, SettldError::InsufficientAgentBalance);
    agent.balance -= amount;
    card.balance = card.balance.checked_add(amount).ok_or(SettldError::Overflow)?;
    emit!(AgentEvent {
        agent: agent.key(),
        owner,
        agent_id,
        action: AGENT_CLAWBACK,
        amount,
        uid,
        nonce: 0,
        policy_hash: agent.policy_hash,
        policy_version: agent.policy_version,
        policy: agent.policy,
        slot: Clock::get()?.slot,
    });
    Ok(())
}
