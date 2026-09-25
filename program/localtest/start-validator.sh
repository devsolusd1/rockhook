#!/usr/bin/env bash
# Local validator for the tests: Meteora DBC and DAMM v2, Metaplex Token Metadata
# and Metaplex Core cloned from mainnet, with the hook built by `anchor build` loaded.
cd "$(dirname "$0")" || exit 1
exec solana-test-validator --reset --quiet --ledger ./ledger \
  --url https://api.mainnet-beta.solana.com \
  --clone-upgradeable-program dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN \
  --clone-upgradeable-program cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG \
  --clone-upgradeable-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s \
  --clone-upgradeable-program CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d \
  --clone A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck \
  --bpf-program 342z5Sawvar7fcAiyt9J82ysEYs5rGaJp5wuH27Q9AAS ../target/deploy/rockhook_hook.so
