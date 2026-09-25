use anchor_lang::prelude::*;

use crate::{constants::*, state::*};

#[derive(Accounts)]
pub struct InitForge<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [STATE_SEED, state.mint.as_ref()], bump = state.bump, has_one = admin)]
    pub state: Account<'info, HookState>,
    #[account(
        init,
        payer = admin,
        space = 8 + Forge::INIT_SPACE,
        seeds = [FORGE_SEED, state.mint.as_ref()],
        bump,
    )]
    pub forge: Account<'info, Forge>,
    pub system_program: Program<'info, System>,
}

pub(crate) fn handler(ctx: Context<InitForge>, tier_thresholds: [u64; 4], routers: Vec<Pubkey>) -> Result<()> {
    let forge = &mut ctx.accounts.forge;
    forge.mint = ctx.accounts.state.mint;
    forge.tier_thresholds = tier_thresholds;
    forge.routers = Forge::routers_from(&routers)?;
    forge.bump = ctx.bumps.forge;
    Ok(())
}
