use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

use crate::{constants::*, error::HookError, state::*};

pub const SLOT_HASHES_ID: Pubkey = pubkey!("SysvarS1otHashes111111111111111111111111111");

/// Picks the random Supernova's point on the lit weight from the hash of a slot
/// fixed at graduation, which nobody could know then. Anyone can call it.
#[derive(Accounts)]
pub struct Draw<'info> {
    #[account(mut, seeds = [ROCKIES_SEED, rockies.mint.as_ref()], bump = rockies.bump)]
    pub rockies: Account<'info, Rockies>,
    /// CHECK: the SlotHashes sysvar.
    #[account(address = SLOT_HASHES_ID)]
    pub slot_hashes: UncheckedAccount<'info>,
}

pub(crate) fn handler(ctx: Context<Draw>) -> Result<()> {
    let rockies = &mut ctx.accounts.rockies;
    require!(rockies.graduated, HookError::NotGraduated);
    require!(!rockies.drawn, HookError::AlreadyDrawn);
    let now = Clock::get()?.slot;
    require!(now > rockies.draw_slot, HookError::DrawTooEarly);

    match slot_hash_at_or_after(&ctx.accounts.slot_hashes, rockies.draw_slot)? {
        Some(hash) => {
            let digest = hashv(&[&hash, rockies.mint.as_ref()]).to_bytes();
            let r = u64::from_le_bytes(digest[..8].try_into().unwrap());
            rockies.draw_target = if rockies.draw_weight > 0 { r % rockies.draw_weight } else { 0 };
            rockies.drawn = true;
            msg!("draw target {} of {}", rockies.draw_target, rockies.draw_weight);
        }
        None => {
            // The slot fell out of SlotHashes before anyone drew: fix a new one.
            require!(now > rockies.draw_slot + DRAW_REARM_AFTER_SLOTS, HookError::DrawTooEarly);
            rockies.draw_slot = now + DRAW_DELAY_SLOTS;
            msg!("draw re-armed for slot {}", rockies.draw_slot);
        }
    }
    Ok(())
}

/// Hash of `target`, or of the first slot after it if `target` was skipped;
/// `None` while that slot isn't known yet or once it has left the sysvar.
/// SlotHashes is a u64 count then (slot u64, hash [u8; 32]) pairs, newest first.
fn slot_hash_at_or_after(sysvar: &AccountInfo, target: u64) -> Result<Option<[u8; 32]>> {
    let data = sysvar.try_borrow_data()?;
    let count = u64::from_le_bytes(data[..8].try_into().unwrap()) as usize;
    let mut found: Option<(u64, [u8; 32])> = None;
    for i in 0..count {
        let o = 8 + i * 40;
        let Some(entry) = data.get(o..o + 40) else { break };
        let slot = u64::from_le_bytes(entry[..8].try_into().unwrap());
        if slot < target {
            // A slot before the target is still listed, so `found` really is the
            // first slot at or after it.
            return Ok(found.map(|(_, hash)| hash));
        }
        found = Some((slot, entry[8..40].try_into().unwrap()));
    }
    // Every listed slot is at or after the target. Unless the oldest one is the
    // target itself, the target may have left the window, and the oldest listed
    // hash changes every slot, so whoever calls could pick when to draw.
    Ok(found.filter(|(slot, _)| *slot == target).map(|(_, hash)| hash))
}
