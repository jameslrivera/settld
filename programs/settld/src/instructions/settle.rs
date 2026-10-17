use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::{constants::*, errors::SettldError, state::*};

#[derive(Accounts)]
#[instruction(merchant_id: u16)]
pub struct Settle<'info> {
    pub issuer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = issuer, has_one = mint, has_one = vault)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [MERCHANT_SEED, &merchant_id.to_le_bytes()], bump = merchant.bump)]
    pub merchant: Account<'info, Merchant>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, constraint = merchant_token_account.key() == merchant.token_account @ SettldError::MerchantAccountMismatch)]
    pub merchant_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_settle(ctx: Context<Settle>, merchant_id: u16, amount: u64) -> Result<()> {
    let bump = ctx.accounts.config.bump;
    let seeds: &[&[u8]] = &[CONFIG_SEED, &[bump]];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.merchant_token_account.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;
    let m = &mut ctx.accounts.merchant;
    m.settled_total = m.settled_total.checked_add(amount).ok_or(SettldError::Overflow)?;
    emit!(SettleEvent { merchant_id, amount, slot: Clock::get()?.slot });
    Ok(())
}
