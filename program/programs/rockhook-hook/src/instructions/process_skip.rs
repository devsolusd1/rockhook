use anchor_lang::prelude::*;

use crate::{constants::*, error::HookError, state::*};

/// Skips the next ledger entry when it is a router buy the router kept (no
/// hand-off in the same transaction): there is no user wallet to credit.
#[derive(Accounts)]
pub struct ProcessSkip<'info> {
    #[account(seeds = [STATE_SEED, state.mint.as_ref()], bump = state.bump, has_one = ledger)]
    pub state: Account<'info, HookState>,
    #[account(mut, seeds = [FORGE_SEED, state.mint.as_ref()], bump = forge.bump)]
    pub forge: Account<'info, Forge>,
    pub ledger: AccountLoader<'info, Ledger>,
}

pub(crate) fn handler(ctx: Context<ProcessSkip>) -> Result<()> {
    let seq = ctx.accounts.forge.next_seq;
    let ledger = ctx.accounts.ledger.load()?;
    let entry = ledger.entry(seq)?;
    let skippable = entry.kind == KIND_BUY
        && ctx.accounts.forge.is_router(&entry.to)
        && handoff(&ledger, &entry).is_none();
    require!(skippable, HookError::NotSkippable);
    ctx.accounts.forge.next_seq = seq + 1;
    Ok(())
}
