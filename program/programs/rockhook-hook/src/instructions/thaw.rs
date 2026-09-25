use anchor_lang::prelude::*;
use mpl_core::{
    instructions::UpdateCollectionPluginV1CpiBuilder,
    types::{PermanentFreezeDelegate, Plugin},
};

use crate::{constants::*, error::HookError, state::*};

/// Unfreezes the whole collection after graduation, so Rockies can be traded.
/// Anyone can call it.
#[derive(Accounts)]
pub struct Thaw<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [ROCKIES_SEED, rockies.mint.as_ref()], bump = rockies.bump)]
    pub rockies: Account<'info, Rockies>,
    /// CHECK: PDA that signs for the collection.
    #[account(seeds = [AUTHORITY_SEED, rockies.mint.as_ref()], bump = rockies.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    /// CHECK: the Rockies collection.
    #[account(mut, address = rockies.collection)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: Metaplex Core.
    #[account(address = mpl_core::ID)]
    pub core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub(crate) fn handler(ctx: Context<Thaw>) -> Result<()> {
    let rockies = &ctx.accounts.rockies;
    require!(rockies.graduated, HookError::NotGraduated);
    require!(!rockies.thawed, HookError::AlreadyThawed);
    // Winners are known before they are crowned: keep every Rocky frozen until
    // they all show as Supernovas, so nobody can buy one off an unaware owner.
    require!(rockies.random_done && rockies.crowned == rockies.winners, HookError::NotCrowned);

    let mint = rockies.mint;
    let authority_seeds: &[&[u8]] = &[AUTHORITY_SEED, mint.as_ref(), &[rockies.authority_bump]];
    UpdateCollectionPluginV1CpiBuilder::new(&ctx.accounts.core_program.to_account_info())
        .collection(&ctx.accounts.collection.to_account_info())
        .payer(&ctx.accounts.payer.to_account_info())
        .authority(Some(&ctx.accounts.authority.to_account_info()))
        .system_program(&ctx.accounts.system_program.to_account_info())
        .plugin(Plugin::PermanentFreezeDelegate(PermanentFreezeDelegate { frozen: false }))
        .invoke_signed(&[authority_seeds])?;

    ctx.accounts.rockies.thawed = true;
    Ok(())
}
