use anchor_lang::prelude::*;

use crate::{constants::*, state::*};

#[derive(Accounts)]
pub struct SetPaused<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [STATE_SEED, state.mint.as_ref()],
        bump = state.bump,
        has_one = admin,
    )]
    pub state: Account<'info, HookState>,
}

pub(crate) fn handler(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
    ctx.accounts.state.paused = paused;
    msg!("hook paused: {}", paused);
    Ok(())
}
