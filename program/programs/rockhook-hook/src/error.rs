use anchor_lang::prelude::*;

#[error_code]
pub enum HookError {
    #[msg("The hook can only run inside a Token-2022 transfer")]
    NotTransferring,
    #[msg("Not a Token-2022 token account")]
    InvalidTokenAccount,
    #[msg("That ledger entry has not been written yet")]
    EntryNotWritten,
    #[msg("That ledger entry was overwritten before it was processed; call recover_overflow")]
    EntryLost,
    #[msg("The next ledger entry in seq order is a different kind; use the matching process instruction")]
    WrongEntryKind,
    #[msg("The wallet does not match the ledger entry")]
    WrongWallet,
    #[msg("A router buy without a hand-off in the same transaction; use process_skip")]
    RouterBuyWithoutHandoff,
    #[msg("Only router buys without a hand-off can be skipped")]
    NotSkippable,
    #[msg("No ledger entries were lost")]
    NothingLost,
    #[msg("Too many routers")]
    TooManyRouters,
    #[msg("This ticket's Rocky was already minted")]
    AlreadyMinted,
    #[msg("This ticket's Rocky hasn't been minted yet")]
    NotMinted,
    #[msg("This Rocky's wallet hasn't sold or sent since the buy")]
    NotBurnt,
    #[msg("This Rocky already shows ash")]
    AlreadyAshed,
    #[msg("A Supernova can't burn out")]
    IsSupernova,
    #[msg("The curve hasn't graduated yet")]
    NotGraduated,
    #[msg("Graduation was already finalized")]
    AlreadyFinalized,
    #[msg("The crank hasn't processed every ledger entry yet")]
    CrankBehind,
    #[msg("Too early: the draw slot hasn't passed")]
    DrawTooEarly,
    #[msg("The random draw is already done")]
    AlreadyDrawn,
    #[msg("Draw first")]
    NotDrawn,
    #[msg("The walk already found the winner")]
    WalkDone,
    #[msg("Pass tickets in order, each with its holder")]
    WrongTicket,
    #[msg("This ticket is not a Supernova")]
    NotAWinner,
    #[msg("This Rocky is already a Supernova")]
    AlreadySupernova,
    #[msg("The collection is already thawed")]
    AlreadyThawed,
    #[msg("uri_base is too long")]
    UriTooLong,
    #[msg("That is not the seq of the next buy")]
    WrongSeq,
    #[msg("Pass each sender's holder account, once per wallet")]
    WrongHolder,
    #[msg("Nothing to process")]
    NothingToProcess,
    #[msg("Draw and crown every Supernova first")]
    NotCrowned,
}
