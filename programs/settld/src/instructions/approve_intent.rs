use anchor_lang::prelude::*;

use crate::{constants::*, state::*};

#[derive(Accounts)]
#[instruction(owner: Pubkey, agent_id: u16, nonce: u64)]
pub struct ApproveIntent<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = issuer)]
    pub config: Account<'info, Config>,
    #[account(seeds = [AGENT_SEED, owner.as_ref(), &agent_id.to_le_bytes()], bump = agent.bump)]
    pub agent: Account<'info, Agent>,
    #[account(
        init,
        payer = issuer,
        space = 8 + Intent::INIT_SPACE,
        seeds = [INTENT_SEED, agent.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub intent: Account<'info, Intent>,
    pub system_program: Program<'info, System>,
}

pub fn handle_approve_intent(ctx: Context<ApproveIntent>, owner: Pubkey, agent_id: u16, nonce: u64, merchant_id: u16, amount: u64, expires_slot: u64, approved_by: Pubkey) -> Result<()> {
    let i = &mut ctx.accounts.intent;
    i.agent = ctx.accounts.agent.key();
    i.nonce = nonce;
    i.merchant_id = merchant_id;
    i.amount = amount;
    i.expires_slot = expires_slot;
    i.approved_by = approved_by;
    i.used = false;
    i.bump = ctx.bumps.intent;
    emit!(AgentEvent {
        agent: ctx.accounts.agent.key(),
        owner,
        agent_id,
        action: INTENT_APPROVED,
        amount,
        uid: [0; UID_LEN],
        nonce,
        policy_hash: ctx.accounts.agent.policy_hash,
        policy_version: ctx.accounts.agent.policy_version,
        policy: ctx.accounts.agent.policy,
        slot: Clock::get()?.slot,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(owner: Pubkey, agent_id: u16, nonce: u64)]
pub struct CloseIntent<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = issuer)]
    pub config: Account<'info, Config>,
    #[account(seeds = [AGENT_SEED, owner.as_ref(), &agent_id.to_le_bytes()], bump = agent.bump)]
    pub agent: Account<'info, Agent>,
    #[account(mut, close = issuer, seeds = [INTENT_SEED, agent.key().as_ref(), &nonce.to_le_bytes()], bump = intent.bump, has_one = agent)]
    pub intent: Account<'info, Intent>,
}

pub fn handle_close_intent(ctx: Context<CloseIntent>, owner: Pubkey, agent_id: u16, nonce: u64) -> Result<()> {
    emit!(AgentEvent {
        agent: ctx.accounts.agent.key(),
        owner,
        agent_id,
        action: INTENT_CLOSED,
        amount: ctx.accounts.intent.amount,
        uid: [0; UID_LEN],
        nonce,
        policy_hash: ctx.accounts.agent.policy_hash,
        policy_version: ctx.accounts.agent.policy_version,
        policy: ctx.accounts.agent.policy,
        slot: Clock::get()?.slot,
    });
    Ok(())
}
