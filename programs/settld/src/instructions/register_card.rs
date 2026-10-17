use anchor_lang::prelude::*;

use crate::{constants::*, state::*};

#[derive(Accounts)]
#[instruction(uid: [u8; UID_LEN])]
pub struct RegisterCard<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = issuer)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = issuer,
        space = 8 + Card::INIT_SPACE,
        seeds = [CARD_SEED, uid.as_ref()],
        bump
    )]
    pub card: Account<'info, Card>,
    pub system_program: Program<'info, System>,
}

pub fn handle_register_card(ctx: Context<RegisterCard>, uid: [u8; UID_LEN], daily_limit: u64, owner: Pubkey) -> Result<()> {
    let card = &mut ctx.accounts.card;
    card.uid = uid;
    card.issuer = ctx.accounts.issuer.key();
    card.status = CardStatus::Active;
    card.kind = CardKind::Person;
    card.owner = owner;
    card.balance = 0;
    card.daily_limit = daily_limit;
    card.spent_today = 0;
    card.day_index = Clock::get()?.slot / SLOTS_PER_DAY;
    card.merchant_mask = ALL_MERCHANTS;
    card.expires_slot = 0;
    card.auth_count = 0;
    card.last_merchant = 0;
    card.last_slot = 0;
    card.bump = ctx.bumps.card;
    emit!(CardEvent { uid, owner, kind: KIND_PERSON, daily_limit, slot: Clock::get()?.slot });
    Ok(())
}

#[derive(Accounts)]
#[instruction(uid: [u8; UID_LEN])]
pub struct SetCardOwner<'info> {
    pub issuer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = issuer)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [CARD_SEED, uid.as_ref()],
        bump = card.bump,
        constraint = card.kind == CardKind::Person @ crate::errors::SettldError::WrongCardKind,
    )]
    pub card: Account<'info, Card>,
}

pub fn handle_set_card_owner(ctx: Context<SetCardOwner>, uid: [u8; UID_LEN], owner: Pubkey) -> Result<()> {
    let card = &mut ctx.accounts.card;
    card.owner = owner;
    emit!(CardEvent { uid, owner, kind: KIND_PERSON, daily_limit: card.daily_limit, slot: Clock::get()?.slot });
    Ok(())
}
