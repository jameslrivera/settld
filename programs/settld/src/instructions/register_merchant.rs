use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

use crate::{constants::*, errors::SettldError, state::*};

#[derive(Accounts)]
#[instruction(merchant_id: u16)]
pub struct RegisterMerchant<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = issuer)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = issuer,
        space = 8 + Merchant::INIT_SPACE,
        seeds = [MERCHANT_SEED, &merchant_id.to_le_bytes()],
        bump
    )]
    pub merchant: Account<'info, Merchant>,
    #[account(constraint = token_account.mint == config.mint, constraint = token_account.key() != config.vault @ SettldError::MerchantIsVault)]
    pub token_account: InterfaceAccount<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
}

pub fn handle_register_merchant(ctx: Context<RegisterMerchant>, merchant_id: u16, category: u8) -> Result<()> {
    let m = &mut ctx.accounts.merchant;
    m.id = merchant_id;
    m.category = category;
    m.token_account = ctx.accounts.token_account.key();
    m.settled_total = 0;
    m.auth_count = 0;
    m.accepts_agents = false;
    m.max_agent_ticket = 0;
    m.bump = ctx.bumps.merchant;
    emit!(MerchantEvent { merchant_id, category, token_account: m.token_account, accepts_agents: false, max_agent_ticket: 0, slot: Clock::get()?.slot });
    Ok(())
}
