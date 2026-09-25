use anchor_lang::prelude::*;

use crate::{constants::*, error::HookError, state::*};

/// If the ledger wrapped past unprocessed entries, jumps to the oldest entry
/// still readable and counts the rest as lost. Anyone can call it.
#[derive(Accounts)]
pub struct RecoverOverflow<'info> {
    #[account(seeds = [STATE_SEED, state.mint.as_ref()], bump = state.bump, has_one = ledger)]
    pub state: Account<'info, HookState>,
    #[account(mut, seeds = [FORGE_SEED, state.mint.as_ref()], bump = forge.bump)]
    pub forge: Account<'info, Forge>,
    pub ledger: AccountLoader<'info, Ledger>,
}

pub(crate) fn handler(ctx: Context<RecoverOverflow>) -> Result<()> {
    let head = ctx.accounts.ledger.load()?.head;
    let forge = &mut ctx.accounts.forge;
    let oldest = head.saturating_sub(LEDGER_CAPACITY as u64);
    require!(forge.next_seq < oldest, HookError::NothingLost);
    forge.lost += oldest - forge.next_seq;
    forge.next_seq = oldest;
    msg!("skipped {} lost ledger entries", forge.lost);
    Ok(())
}
