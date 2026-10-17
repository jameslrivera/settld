use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::{constants::*, errors::SettldError, state::*};

#[derive(Accounts)]
#[instruction(uid: [u8; UID_LEN], amount: u64, risk_bps: u16, merchant_id: u16)]
pub struct PayAgent<'info> {
    pub issuer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = issuer, has_one = mint, has_one = vault)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [CARD_SEED, uid.as_ref()],
        bump = card.bump,
        constraint = card.kind == CardKind::Task @ SettldError::WrongCardKind,
        constraint = card.owner == agent.key() @ SettldError::NotOwner,
    )]
    pub card: Account<'info, Card>,
    #[account(mut, seeds = [AGENT_SEED, agent.owner.as_ref(), &agent.agent_id.to_le_bytes()], bump = agent.bump)]
    pub agent: Account<'info, Agent>,
    #[account(mut, seeds = [MERCHANT_SEED, &merchant_id.to_le_bytes()], bump = merchant.bump)]
    pub merchant: Account<'info, Merchant>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, constraint = merchant_token_account.key() == merchant.token_account @ SettldError::MerchantAccountMismatch)]
    pub merchant_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub intent: Option<Account<'info, Intent>>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn decide_agent(
    card: &mut Card,
    agent: &mut Agent,
    merchant: &Merchant,
    intent: Option<&mut Intent>,
    amount: u64,
    risk_bps: u16,
    merchant_id: u16,
    slot: u64,
    ts: i64,
    decline_bps: u16,
) -> Result<(bool, bool, u8)> {
    let day = (ts / 86_400) as u64;
    if day != agent.day_index {
        agent.day_index = day;
        agent.spent_today = 0;
    }
    let hour_index = (ts / 3_600) as u64;
    if hour_index != agent.hour_index {
        agent.hour_index = hour_index;
        agent.txn_this_hour = 0;
    }
    let card_day = slot / SLOTS_PER_DAY;
    if card_day != card.day_index {
        card.day_index = card_day;
        card.spent_today = 0;
    }
    let hour = (hour_index % 24) as u8;
    let p = agent.policy;
    let needs_approval = amount > p.approval_threshold;
    let intent_ok = match &intent {
        Some(i) => !i.used && i.merchant_id == merchant_id && i.amount >= amount && (i.expires_slot == 0 || slot <= i.expires_slot),
        None => false,
    };
    let merchant_ok = merchant.accepts_agents
        && mask_allows(p.merchant_mask, merchant_id)
        && mask_allows(card.merchant_mask, merchant_id)
        && (merchant.max_agent_ticket == 0 || amount <= merchant.max_agent_ticket);

    let reason = if agent.frozen {
        REASON_AGENT_FROZEN
    } else if card.status == CardStatus::Blocked {
        REASON_BLOCKED
    } else if card.expires_slot != 0 && slot > card.expires_slot {
        REASON_TASK_EXPIRED
    } else if risk_bps >= decline_bps {
        REASON_HIGH_RISK
    } else if !merchant_ok {
        REASON_MERCHANT_NOT_ALLOWED
    } else if !in_hours(p.hour_start, p.hour_end, hour) {
        REASON_OUTSIDE_WINDOW
    } else if amount > p.per_txn_max
        || agent.spent_today.saturating_add(amount) > p.daily_max
        || agent.spent_total.saturating_add(amount) > p.budget_total
    {
        REASON_OVER_BUDGET
    } else if p.max_txn_per_hour != 0 && agent.txn_this_hour >= p.max_txn_per_hour {
        REASON_TOO_MANY_PER_HOUR
    } else if needs_approval && !intent_ok {
        REASON_NEEDS_APPROVAL
    } else if card.balance < amount {
        REASON_INSUFFICIENT
    } else {
        REASON_OK
    };

    let approved = reason == REASON_OK;
    let mut used = false;
    if approved {
        card.balance = card.balance.checked_sub(amount).ok_or(SettldError::InsufficientBalance)?;
        card.spent_today = card.spent_today.checked_add(amount).ok_or(SettldError::Overflow)?;
        agent.spent_today = agent.spent_today.checked_add(amount).ok_or(SettldError::Overflow)?;
        agent.spent_total = agent.spent_total.checked_add(amount).ok_or(SettldError::Overflow)?;
        agent.txn_this_hour = agent.txn_this_hour.saturating_add(1);
        if needs_approval {
            if let Some(i) = intent {
                i.used = true;
                used = true;
            }
        }
    }
    card.auth_count = card.auth_count.saturating_add(1);
    card.last_merchant = merchant_id;
    card.last_slot = slot;
    agent.auth_count = agent.auth_count.saturating_add(1);
    Ok((approved, used, reason))
}

pub fn handle_pay_agent(ctx: Context<PayAgent>, uid: [u8; UID_LEN], amount: u64, risk_bps: u16, merchant_id: u16, nonce: u64) -> Result<()> {
    require!(amount > 0, SettldError::ZeroAmount);
    let clock = Clock::get()?;
    let decline_bps = ctx.accounts.config.decline_bps;
    if let Some(i) = &ctx.accounts.intent {
        require_keys_eq!(i.agent, ctx.accounts.agent.key(), SettldError::IntentMismatch);
    }
    let intent = ctx.accounts.intent.as_deref_mut();
    let (approved, intent_used, reason) = decide_agent(
        &mut ctx.accounts.card,
        &mut ctx.accounts.agent,
        &ctx.accounts.merchant,
        intent,
        amount,
        risk_bps,
        merchant_id,
        clock.slot,
        clock.unix_timestamp,
        decline_bps,
    )?;

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

    emit!(AuthEvent {
        uid,
        merchant_id,
        amount,
        risk_bps,
        approved,
        reason,
        settled: approved,
        kind: KIND_TASK,
        agent_id: ctx.accounts.agent.agent_id,
        agent: ctx.accounts.agent.key(),
        intent_used,
        slot: clock.slot,
        nonce,
    });
    Ok(())
}
