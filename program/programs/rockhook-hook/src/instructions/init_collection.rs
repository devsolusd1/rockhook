use anchor_lang::prelude::*;
use mpl_core::{
    instructions::CreateCollectionV2CpiBuilder,
    types::{Creator, PermanentFreezeDelegate, Plugin, PluginAuthority, PluginAuthorityPair, Royalties, RuleSet},
};

use crate::{constants::*, error::HookError, state::*};

/// Creates the Rockies collection. The program's authority PDA owns it, and the
/// whole collection starts frozen: no Rocky can move until graduation.
#[derive(Accounts)]
pub struct InitCollection<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [STATE_SEED, state.mint.as_ref()], bump = state.bump, has_one = admin)]
    pub state: Account<'info, HookState>,
    #[account(
        init,
        payer = admin,
        space = 8 + Rockies::INIT_SPACE,
        seeds = [ROCKIES_SEED, state.mint.as_ref()],
        bump,
    )]
    pub rockies: Account<'info, Rockies>,
    /// CHECK: PDA that signs for the collection.
    #[account(seeds = [AUTHORITY_SEED, state.mint.as_ref()], bump)]
    pub authority: UncheckedAccount<'info>,
    /// CHECK: Metaplex Core creates the collection at this PDA.
    #[account(mut, seeds = [COLLECTION_SEED, state.mint.as_ref()], bump)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: Metaplex Core.
    #[account(address = mpl_core::ID)]
    pub core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub(crate) fn handler(
    ctx: Context<InitCollection>,
    name: String,
    uri: String,
    uri_base: String,
    royalty_bps: u16,
) -> Result<()> {
    require!(uri_base.len() <= 120, HookError::UriTooLong);
    let mint = ctx.accounts.state.mint;

    let mut plugins = vec![PluginAuthorityPair {
        plugin: Plugin::PermanentFreezeDelegate(PermanentFreezeDelegate { frozen: true }),
        authority: Some(PluginAuthority::UpdateAuthority),
    }];
    if royalty_bps > 0 {
        plugins.push(PluginAuthorityPair {
            plugin: Plugin::Royalties(Royalties {
                basis_points: royalty_bps,
                creators: vec![Creator { address: ctx.accounts.admin.key(), percentage: 100 }],
                rule_set: RuleSet::None,
            }),
            authority: Some(PluginAuthority::UpdateAuthority),
        });
    }

    let collection_seeds: &[&[u8]] = &[COLLECTION_SEED, mint.as_ref(), &[ctx.bumps.collection]];
    CreateCollectionV2CpiBuilder::new(&ctx.accounts.core_program.to_account_info())
        .collection(&ctx.accounts.collection.to_account_info())
        .update_authority(Some(&ctx.accounts.authority.to_account_info()))
        .payer(&ctx.accounts.admin.to_account_info())
        .system_program(&ctx.accounts.system_program.to_account_info())
        .name(name)
        .uri(uri)
        .plugins(plugins)
        .invoke_signed(&[collection_seeds])?;

    let rockies = &mut ctx.accounts.rockies;
    rockies.mint = mint;
    rockies.collection = ctx.accounts.collection.key();
    rockies.uri_base = uri_base;
    rockies.bump = ctx.bumps.rockies;
    rockies.authority_bump = ctx.bumps.authority;
    rockies.collection_bump = ctx.bumps.collection;
    Ok(())
}
