use anchor_lang::prelude::*;

use crate::{constants::*, error::HookError, state::*};

/// After graduation, once every entry is processed, closes the ledger and
/// returns its rent to the admin. The hook no longer runs by then.
#[derive(Accounts)]
pub struct CloseLedger<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [STATE_SEED, state.mint.as_ref()], bump = state.bump, has_one = admin, has_one = ledger)]
    pub state: Account<'info, HookState>,
    #[account(seeds = [FORGE_SEED, state.mint.as_ref()], bump = forge.bump)]
    pub forge: Account<'info, Forge>,
    #[account(seeds = [ROCKIES_SEED, state.mint.as_ref()], bump = rockies.bump)]
    pub rockies: Account<'info, Rockies>,
    #[account(mut, close = admin)]
    pub ledger: AccountLoader<'info, Ledger>,
}

pub(crate) fn handler(ctx: Context<CloseLedger>) -> Result<()> {
    require!(ctx.accounts.rockies.graduated, HookError::NotGraduated);
    require!(ctx.accounts.forge.caught_up(&*ctx.accounts.ledger.load()?), HookError::CrankBehind);
    Ok(())
}
