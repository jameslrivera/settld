use anchor_lang::prelude::*;

use crate::{constants::*, errors::SettldError, state::*};

#[derive(Accounts)]
#[instruction(owner: Pubkey, agent_id: u16)]
pub struct SetAgentFrozen<'info> {
    pub issuer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = issuer)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [AGENT_SEED, owner.as_ref(), &agent_id.to_le_bytes()], bump = agent.bump)]
    pub agent: Account<'info, Agent>,
}

pub fn handle_set_agent_frozen(ctx: Context<SetAgentFrozen>, owner: Pubkey, agent_id: u16, frozen: bool) -> Result<()> {
    let a = &mut ctx.accounts.agent;
    a.frozen = frozen;
    emit!(AgentEvent {
        agent: a.key(),
        owner,
        agent_id,
        action: if frozen { AGENT_FROZEN } else { AGENT_UNFROZEN },
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

#[derive(Accounts)]
pub struct FreezeAll<'info> {
    pub issuer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = issuer)]
    pub config: Account<'info, Config>,
}

pub fn handle_freeze_all<'info>(ctx: Context<'info, FreezeAll<'info>>, owner: Pubkey) -> Result<()> {
    let slot = Clock::get()?.slot;
    for info in ctx.remaining_accounts.iter() {
        let mut a = Account::<Agent>::try_from(info)?;
        require_keys_eq!(a.owner, owner, SettldError::NotOwner);
        a.frozen = true;
        emit!(AgentEvent {
            agent: a.key(),
            owner,
            agent_id: a.agent_id,
            action: AGENT_FROZEN,
            amount: 0,
            uid: [0; UID_LEN],
            nonce: 0,
            policy_hash: a.policy_hash,
            policy_version: a.policy_version,
            policy: a.policy,
            slot,
        });
        a.exit(ctx.program_id)?;
    }
    Ok(())
}
