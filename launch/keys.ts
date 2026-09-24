import bs58 from 'bs58';

/**
 * Accepts a secret key as either a base58 string (Phantom export) or a
 * JSON array of bytes (solana-keygen format) and returns the raw bytes.
 */
export function parseSecretKey(secret: string): Uint8Array {
  const trimmed = secret.trim().replace(/^["']|["']$/g, '');
  if (trimmed.startsWith('[')) {
    return Uint8Array.from(JSON.parse(trimmed) as number[]);
  }
  return bs58.decode(trimmed);
}
