use anchor_lang::prelude::*;

use crate::{constants::*, state::*};

#[derive(Accounts)]
#[instruction(uid: [u8; UID_LEN])]
pub struct SetCardStatus<'info> {
    pub issuer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = issuer)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [CARD_SEED, uid.as_ref()], bump = card.bump)]
    pub card: Account<'info, Card>,
}

pub fn handle_set_card_status(ctx: Context<SetCardStatus>, uid: [u8; UID_LEN], status: CardStatus) -> Result<()> {
    ctx.accounts.card.status = status;
    emit!(StatusEvent { uid, status, slot: Clock::get()?.slot });
    Ok(())
}
