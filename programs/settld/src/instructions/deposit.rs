use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::{constants::*, errors::SettldError, state::*};

#[derive(Accounts)]
#[instruction(uid: [u8; UID_LEN])]
pub struct Deposit<'info> {
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = mint, has_one = vault)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [CARD_SEED, uid.as_ref()],
        bump = card.bump,
        constraint = card.kind == CardKind::Person @ SettldError::WrongCardKind,
    )]
    pub card: Account<'info, Card>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, constraint = from.mint == config.mint, constraint = from.owner == payer.key())]
    pub from: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_deposit(ctx: Context<Deposit>, uid: [u8; UID_LEN], amount: u64) -> Result<()> {
    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.from.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.payer.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;
    let card = &mut ctx.accounts.card;
    card.balance = card.balance.checked_add(amount).ok_or(SettldError::Overflow)?;
    emit!(DepositEvent { uid, amount, balance: card.balance, slot: Clock::get()?.slot });
    Ok(())
}
