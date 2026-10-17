use anchor_lang::prelude::*;

use crate::{constants::*, state::*};

#[derive(Accounts)]
#[instruction(owner: Pubkey, agent_id: u16)]
pub struct SetAgentPolicy<'info> {
    pub issuer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = issuer)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [AGENT_SEED, owner.as_ref(), &agent_id.to_le_bytes()], bump = agent.bump)]
    pub agent: Account<'info, Agent>,
}

pub fn handle_set_agent_policy(ctx: Context<SetAgentPolicy>, owner: Pubkey, agent_id: u16, policy: AgentPolicy) -> Result<()> {
    policy.validate()?;
    let a = &mut ctx.accounts.agent;
    a.policy = policy;
    a.policy_version = a.policy_version.saturating_add(1);
    a.policy_hash = policy.hash()?;
    emit!(AgentEvent {
        agent: a.key(),
        owner,
        agent_id,
        action: AGENT_POLICY_SET,
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
