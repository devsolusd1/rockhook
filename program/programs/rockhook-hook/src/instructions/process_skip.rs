use anchor_lang::prelude::*;

use crate::{constants::*, error::HookError, state::*};

/// Skips the next buy-ring entry when there is no user wallet to credit: a
/// router buy the router kept (no hand-off in the same slot), or a hand-off
/// with no router buy before it.
#[derive(Accounts)]
pub struct ProcessSkip<'info> {
    #[account(seeds = [STATE_SEED, state.mint.as_ref()], bump = state.bump, has_one = ledger)]
    pub state: Account<'info, HookState>,
    #[account(mut, seeds = [FORGE_SEED, state.mint.as_ref()], bump = forge.bump)]
    pub forge: Account<'info, Forge>,
    pub ledger: AccountLoader<'info, Ledger>,
}

pub(crate) fn handler(ctx: Context<ProcessSkip>) -> Result<()> {
    let index = ctx.accounts.forge.next_buy;
    let ledger = ctx.accounts.ledger.load()?;
    let entry = ledger.buy(index)?;
    let skippable = match entry.kind {
        KIND_ROUTER_BUY => handoff(&ledger, index, &entry).is_none(),
        KIND_HANDOFF => true,
        _ => false,
    };
    require!(skippable, HookError::NotSkippable);
    ctx.accounts.forge.next_buy = index + 1;
    Ok(())
}
