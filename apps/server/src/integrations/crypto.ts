import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export interface EncryptedField {
  v: 1;
  iv: string;
  tag: string;
  ct: string;
}

// Load and validate the encryption key once at module load
const keyHex = process.env.CREDENTIAL_ENCRYPTION_KEY;
if (!keyHex) {
  throw new Error('CREDENTIAL_ENCRYPTION_KEY environment variable is required');
}
if (!new RegExp(`^[0-9a-fA-F]{${KEY_LENGTH * 2}}$`).test(keyHex)) {
  throw new Error(`CREDENTIAL_ENCRYPTION_KEY must be exactly ${KEY_LENGTH * 2} hex characters`);
}
const key = Buffer.from(keyHex, 'hex');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function encryptField(plaintext: string): EncryptedField {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: encrypted.toString('base64'),
  };
}

export function decryptField(envelope: EncryptedField): string {
  if (envelope.v !== 1) {
    throw new Error(`Unsupported encryption version: ${envelope.v}`);
  }

  const iv = Buffer.from(envelope.iv, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  const ciphertext = Buffer.from(envelope.ct, 'base64');

  // GCM requires exact IV and auth-tag sizes; reject malformed envelopes before decrypting.
  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid encrypted field IV length: expected ${IV_LENGTH} bytes`);
  }
  if (tag.length !== TAG_LENGTH) {
    throw new Error(`Invalid encrypted field auth tag length: expected ${TAG_LENGTH} bytes`);
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

export function isEncrypted(value: unknown): value is EncryptedField {
  return (
    isRecord(value) &&
    value.v === 1 &&
    typeof value.iv === 'string' &&
    typeof value.tag === 'string' &&
    typeof value.ct === 'string'
  );
}

export function encryptConfigFields(
  config: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const result = { ...config };

  for (const field of fields) {
    if (field in result && typeof result[field] === 'string') {
      result[field] = encryptField(result[field] as string);
    }
  }

  return result;
}

export function decryptConfigFields(
  config: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const result = { ...config };

  for (const field of fields) {
    if (field in result) {
      const value = result[field];
      if (isEncrypted(value)) {
        result[field] = decryptField(value);
      }
    }
  }

  return result;
}
