use anchor_lang::prelude::*;

use crate::{constants::*, state::*};

#[derive(Accounts)]
pub struct SetRouters<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [STATE_SEED, state.mint.as_ref()], bump = state.bump, has_one = admin)]
    pub state: Account<'info, HookState>,
    #[account(mut, seeds = [FORGE_SEED, state.mint.as_ref()], bump = forge.bump)]
    pub forge: Account<'info, Forge>,
}

pub(crate) fn handler(ctx: Context<SetRouters>, routers: Vec<Pubkey>) -> Result<()> {
    ctx.accounts.forge.routers = Forge::routers_from(&routers)?;
    Ok(())
}
