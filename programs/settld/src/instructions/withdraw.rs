use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::{constants::*, errors::SettldError, state::*};

#[derive(Accounts)]
#[instruction(uid: [u8; UID_LEN])]
pub struct Withdraw<'info> {
    pub issuer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = issuer, has_one = mint, has_one = vault)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [CARD_SEED, uid.as_ref()],
        bump = card.bump,
        constraint = card.kind == CardKind::Person @ SettldError::WrongCardKind,
    )]
    pub card: Account<'info, Card>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, constraint = destination.mint == config.mint)]
    pub destination: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_withdraw(ctx: Context<Withdraw>, uid: [u8; UID_LEN], amount: u64) -> Result<()> {
    require!(ctx.accounts.card.status == CardStatus::Active, SettldError::CardBlocked);
    require!(ctx.accounts.card.balance >= amount, SettldError::InsufficientBalance);
    let bump = ctx.accounts.config.bump;
    let seeds: &[&[u8]] = &[CONFIG_SEED, &[bump]];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;
    let card = &mut ctx.accounts.card;
    card.balance -= amount;
    emit!(WithdrawEvent { uid, amount, balance: card.balance, slot: Clock::get()?.slot });
    Ok(())
}
