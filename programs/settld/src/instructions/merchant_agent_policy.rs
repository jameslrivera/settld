use anchor_lang::prelude::*;

use crate::{constants::*, state::*};

#[derive(Accounts)]
#[instruction(merchant_id: u16)]
pub struct SetMerchantAgentPolicy<'info> {
    pub issuer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = issuer)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [MERCHANT_SEED, &merchant_id.to_le_bytes()], bump = merchant.bump)]
    pub merchant: Account<'info, Merchant>,
}

pub fn handle_set_merchant_agent_policy(ctx: Context<SetMerchantAgentPolicy>, merchant_id: u16, accepts_agents: bool, max_agent_ticket: u64) -> Result<()> {
    let m = &mut ctx.accounts.merchant;
    m.accepts_agents = accepts_agents;
    m.max_agent_ticket = max_agent_ticket;
    emit!(MerchantEvent { merchant_id, category: m.category, token_account: m.token_account, accepts_agents, max_agent_ticket, slot: Clock::get()?.slot });
    Ok(())
}
