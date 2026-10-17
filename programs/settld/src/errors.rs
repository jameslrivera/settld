use anchor_lang::prelude::*;

#[error_code]
pub enum SettldError {
    #[msg("Signer is not the issuer")]
    Unauthorized,
    #[msg("Card is blocked")]
    CardBlocked,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Batch item count does not match card account count")]
    BatchLengthMismatch,
    #[msg("Card balance is lower than the amount")]
    InsufficientBalance,
    #[msg("Merchant token account does not match the merchant record")]
    MerchantAccountMismatch,
    #[msg("Card kind does not allow this instruction")]
    WrongCardKind,
    #[msg("Account is not owned by this owner or agent")]
    NotOwner,
    #[msg("Agent balance is lower than the amount")]
    InsufficientAgentBalance,
    #[msg("Agent is frozen")]
    AgentIsFrozen,
    #[msg("Policy values are out of range")]
    BadPolicy,
    #[msg("Intent does not belong to this agent")]
    IntentMismatch,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Merchant payout account cannot be the vault")]
    MerchantIsVault,
}
