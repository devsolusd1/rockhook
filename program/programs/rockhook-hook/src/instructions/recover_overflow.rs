use anchor_lang::prelude::*;

use crate::{constants::*, error::HookError, state::*};

/// If a ledger ring wrapped past unread entries, jumps to its oldest entry
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
    let ledger = ctx.accounts.ledger.load()?;
    let forge = &mut ctx.accounts.forge;
    let oldest_buy = ledger.buy_count.saturating_sub(BUY_CAPACITY as u64);
    let oldest_out = ledger.out_count.saturating_sub(OUT_CAPACITY as u64);
    require!(forge.next_buy < oldest_buy || forge.next_out < oldest_out, HookError::NothingLost);
    if forge.next_buy < oldest_buy {
        forge.lost_buys += oldest_buy - forge.next_buy;
        forge.next_buy = oldest_buy;
    }
    if forge.next_out < oldest_out {
        forge.lost_outs += oldest_out - forge.next_out;
        forge.next_out = oldest_out;
    }
    msg!("lost so far: {} buys, {} sells and sends", forge.lost_buys, forge.lost_outs);
    Ok(())
}
