import { Algorithm, hash, verify } from '@node-rs/argon2';

// Argon2id via @node-rs/argon2 rather than the `argon2` npm package: the runtime
// image is node:22-alpine (musl) and @node-rs ships musl prebuilds, so the image
// needs no C toolchain. Same algorithm, same parameters.
const OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

// Verified when no user matches, so a missing account costs the same wall-clock
// time as a wrong password and cannot be distinguished by timing.
const DECOY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$Aqvx8Zk4/KS4/KIRduVn8w$bW1biPqiyHQDyVW/nBYvjCZ95Y9GU183pEJkCHmasoo';

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;

export async function hashPassword(plaintext: string): Promise<string> {
  if (plaintext.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`password_too_short:min_${MIN_PASSWORD_LENGTH}`);
  }
  if (plaintext.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`password_too_long:max_${MAX_PASSWORD_LENGTH}`);
  }
  return hash(plaintext, OPTIONS);
}

export async function verifyPassword(passwordHash: string, plaintext: string): Promise<boolean> {
  try {
    return await verify(passwordHash, plaintext, OPTIONS);
  } catch {
    // A stored hash we cannot parse is a failed verification, never an accept.
    return false;
  }
}

export async function burnDecoyVerification(plaintext: string): Promise<void> {
  await verifyPassword(DECOY_HASH, plaintext);
}
