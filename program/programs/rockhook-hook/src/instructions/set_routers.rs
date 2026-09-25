use anchor_lang::prelude::*;

use crate::{constants::*, state::*};

/// Replaces the router list. The hook reads it when it records, so a change
/// only affects trades made after it.
#[derive(Accounts)]
pub struct SetRouters<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [STATE_SEED, state.mint.as_ref()], bump = state.bump, has_one = admin)]
    pub state: Account<'info, HookState>,
}

pub(crate) fn handler(ctx: Context<SetRouters>, routers: Vec<Pubkey>) -> Result<()> {
    ctx.accounts.state.routers = HookState::routers_from(&routers)?;
    Ok(())
}
