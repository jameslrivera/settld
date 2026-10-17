use anchor_lang::prelude::*;

use crate::{constants::*, errors::SettldError, instructions::pay::decide, state::*};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AuthItem {
    pub amount: u64,
    pub risk_bps: u16,
    pub merchant_id: u16,
}

#[derive(Accounts)]
pub struct AuthorizeBatch<'info> {
    pub issuer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = issuer)]
    pub config: Account<'info, Config>,
}

pub fn handle_authorize_batch<'info>(ctx: Context<'info, AuthorizeBatch<'info>>, nonce: u64, items: Vec<AuthItem>) -> Result<()> {
    require!(ctx.remaining_accounts.len() == items.len(), SettldError::BatchLengthMismatch);
    let issuer = ctx.accounts.issuer.key();
    let decline_bps = ctx.accounts.config.decline_bps;
    let slot = Clock::get()?.slot;

    for (i, (item, info)) in items.iter().zip(ctx.remaining_accounts.iter()).enumerate() {
        let mut card = Account::<Card>::try_from(info)?;
        require_keys_eq!(card.issuer, issuer, SettldError::Unauthorized);
        require!(card.kind == CardKind::Person, SettldError::WrongCardKind);
        let (approved, reason) = decide(&mut card, item.amount, item.risk_bps, item.merchant_id, slot, decline_bps)?;
        emit!(AuthEvent {
            uid: card.uid,
            merchant_id: item.merchant_id,
            amount: item.amount,
            risk_bps: item.risk_bps,
            approved,
            reason,
            settled: false,
            kind: KIND_PERSON,
            agent_id: 0,
            agent: Pubkey::default(),
            intent_used: false,
            slot,
            nonce: nonce.wrapping_add(i as u64),
        });
        card.exit(ctx.program_id)?;
    }
    Ok(())
}
