use anchor_lang::prelude::*;

use crate::{constants::*, state::*};

#[derive(Accounts)]
#[instruction(owner: Pubkey, agent_id: u16)]
pub struct RegisterAgent<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = issuer)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = issuer,
        space = 8 + Agent::INIT_SPACE,
        seeds = [AGENT_SEED, owner.as_ref(), &agent_id.to_le_bytes()],
        bump
    )]
    pub agent: Account<'info, Agent>,
    pub system_program: Program<'info, System>,
}

pub fn handle_register_agent(ctx: Context<RegisterAgent>, owner: Pubkey, agent_id: u16, policy: AgentPolicy) -> Result<()> {
    policy.validate()?;
    let a = &mut ctx.accounts.agent;
    a.owner = owner;
    a.agent_id = agent_id;
    a.frozen = false;
    a.balance = 0;
    a.policy = policy;
    a.policy_version = 1;
    a.policy_hash = policy.hash()?;
    a.spent_total = 0;
    a.spent_today = 0;
    a.day_index = 0;
    a.txn_this_hour = 0;
    a.hour_index = 0;
    a.open_tasks = 0;
    a.auth_count = 0;
    a.bump = ctx.bumps.agent;
    emit!(AgentEvent {
        agent: a.key(),
        owner,
        agent_id,
        action: AGENT_REGISTERED,
        amount: 0,
        uid: [0; UID_LEN],
        nonce: 0,
        policy_hash: a.policy_hash,
        policy_version: a.policy_version,
        policy: a.policy,
        slot: Clock::get()?.slot,
    });
    Ok(())
}
