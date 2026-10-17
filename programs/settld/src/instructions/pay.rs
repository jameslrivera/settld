use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::{constants::*, errors::SettldError, state::*};

#[derive(Accounts)]
#[instruction(uid: [u8; UID_LEN], amount: u64, risk_bps: u16, merchant_id: u16)]
pub struct Pay<'info> {
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
    #[account(mut, seeds = [MERCHANT_SEED, &merchant_id.to_le_bytes()], bump = merchant.bump)]
    pub merchant: Account<'info, Merchant>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, constraint = merchant_token_account.key() == merchant.token_account @ SettldError::MerchantAccountMismatch)]
    pub merchant_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn decide(card: &mut Card, amount: u64, risk_bps: u16, merchant_id: u16, slot: u64, decline_bps: u16) -> Result<(bool, u8)> {
    let day = slot / SLOTS_PER_DAY;
    if day != card.day_index {
        card.day_index = day;
        card.spent_today = 0;
    }
    let reason = if card.status == CardStatus::Blocked {
        REASON_BLOCKED
    } else if risk_bps >= decline_bps {
        REASON_HIGH_RISK
    } else if card.spent_today.saturating_add(amount) > card.daily_limit {
        REASON_OVER_LIMIT
    } else if card.balance < amount {
        REASON_INSUFFICIENT
    } else {
        REASON_OK
    };
    let approved = reason == REASON_OK;
    if approved {
        card.spent_today = card.spent_today.checked_add(amount).ok_or(SettldError::Overflow)?;
        card.balance = card.balance.checked_sub(amount).ok_or(SettldError::InsufficientBalance)?;
    }
    card.auth_count = card.auth_count.saturating_add(1);
    card.last_merchant = merchant_id;
    card.last_slot = slot;
    Ok((approved, reason))
}

pub fn handle_pay(ctx: Context<Pay>, uid: [u8; UID_LEN], amount: u64, risk_bps: u16, merchant_id: u16, nonce: u64) -> Result<()> {
    require!(amount > 0, SettldError::ZeroAmount);
    let slot = Clock::get()?.slot;
    let decline_bps = ctx.accounts.config.decline_bps;
    let (approved, reason) = decide(&mut ctx.accounts.card, amount, risk_bps, merchant_id, slot, decline_bps)?;

    if approved {
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
    }
    ctx.accounts.merchant.auth_count = ctx.accounts.merchant.auth_count.saturating_add(1);

    emit!(AuthEvent { uid, merchant_id, amount, risk_bps, approved, reason, settled: approved, kind: KIND_PERSON, agent_id: 0, agent: Pubkey::default(), intent_used: false, slot, nonce });
    Ok(())
}
