// Ensure .env is loaded before crypto module reads CREDENTIAL_ENCRYPTION_KEY
import '../src/config.js';

import { describe, it, expect } from 'vitest';
import {
  encryptField,
  decryptField,
  isEncrypted,
  encryptConfigFields,
  decryptConfigFields,
  type EncryptedField,
} from '../src/integrations/crypto.js';
import { maskSecret } from '../src/integrations/mask.js';

describe('Credential Encryption', () => {
  describe('encryptField / decryptField', () => {
    it('should encrypt and decrypt a string round-trip', () => {
      // Not digits after the prefix — a realistic-format token trips GitHub push protection
      const plaintext = 'xoxb-fake-fixture-abcdefghijklmnopqrstuvwxyz1234567890';
      const encrypted = encryptField(plaintext);

      expect(encrypted).toHaveProperty('v', 1);
      expect(encrypted).toHaveProperty('iv');
      expect(encrypted).toHaveProperty('tag');
      expect(encrypted).toHaveProperty('ct');
      expect(typeof encrypted.iv).toBe('string');
      expect(typeof encrypted.tag).toBe('string');
      expect(typeof encrypted.ct).toBe('string');

      const decrypted = decryptField(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should generate different IVs for the same plaintext', () => {
      const plaintext = 'same-secret-value';
      const encrypted1 = encryptField(plaintext);
      const encrypted2 = encryptField(plaintext);

      // IVs should be different (randomness check)
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      // Ciphertexts should be different due to different IVs
      expect(encrypted1.ct).not.toBe(encrypted2.ct);
      // Both should decrypt to the same value
      expect(decryptField(encrypted1)).toBe(plaintext);
      expect(decryptField(encrypted2)).toBe(plaintext);
    });

    it('should throw on tampered ciphertext', () => {
      const encrypted = encryptField('secret-value');

      // Tamper with the ciphertext
      const tampered: EncryptedField = {
        ...encrypted,
        ct: Buffer.from('tampered').toString('base64'),
      };

      expect(() => decryptField(tampered)).toThrow();
    });

    it('should throw on tampered auth tag', () => {
      const encrypted = encryptField('secret-value');

      // Tamper with the auth tag
      const tampered: EncryptedField = {
        ...encrypted,
        tag: Buffer.from('badtag').toString('base64'),
      };

      expect(() => decryptField(tampered)).toThrow();
    });

    it('should reject an envelope with an invalid IV length', () => {
      const encrypted = encryptField('secret-value');

      // Malformed encrypted envelopes should fail before AES-GCM decrypts them.
      expect(() => decryptField({
        ...encrypted,
        iv: Buffer.from('short').toString('base64'),
      })).toThrow('Invalid encrypted field IV length');
    });

    it('should reject an envelope with an invalid auth tag length', () => {
      const encrypted = encryptField('secret-value');

      // Malformed encrypted envelopes should fail before AES-GCM decrypts them.
      expect(() => decryptField({
        ...encrypted,
        tag: Buffer.from('short').toString('base64'),
      })).toThrow('Invalid encrypted field auth tag length');
    });

    it('should handle empty strings', () => {
      const plaintext = '';
      const encrypted = encryptField(plaintext);
      const decrypted = decryptField(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should handle unicode characters', () => {
      const plaintext = '🔐 Секретный ключ 密钥';
      const encrypted = encryptField(plaintext);
      const decrypted = decryptField(encrypted);
      expect(decrypted).toBe(plaintext);
    });
  });

  describe('isEncrypted', () => {
    it('should identify encrypted fields', () => {
      const encrypted = encryptField('test');
      expect(isEncrypted(encrypted)).toBe(true);
    });

    it('should reject non-encrypted values', () => {
      expect(isEncrypted('plaintext')).toBe(false);
      expect(isEncrypted(123)).toBe(false);
      expect(isEncrypted(null)).toBe(false);
      expect(isEncrypted(undefined)).toBe(false);
      expect(isEncrypted({})).toBe(false);
      expect(isEncrypted({ v: 2 })).toBe(false); // wrong version
      expect(isEncrypted({ v: 1, iv: 'test' })).toBe(false); // missing fields
    });
  });

  describe('encryptConfigFields', () => {
    it('should only encrypt specified fields', () => {
      const config = {
        name: 'My Integration',
        botToken: 'xoxb-secret-token',
        signingSecret: 'signing-secret-value',
        publicField: 'not-encrypted',
      };

      const encrypted = encryptConfigFields(config, ['botToken', 'signingSecret']);

      expect(encrypted.name).toBe('My Integration');
      expect(encrypted.publicField).toBe('not-encrypted');
      expect(isEncrypted(encrypted.botToken)).toBe(true);
      expect(isEncrypted(encrypted.signingSecret)).toBe(true);

      // Verify they decrypt correctly
      const decrypted = decryptConfigFields(encrypted, ['botToken', 'signingSecret']);
      expect(decrypted.botToken).toBe('xoxb-secret-token');
      expect(decrypted.signingSecret).toBe('signing-secret-value');
    });

    it('should skip non-string fields', () => {
      const config = {
        stringField: 'encrypt-me',
        numberField: 123,
        boolField: true,
        nullField: null,
        objectField: { nested: 'value' },
      };

      const encrypted = encryptConfigFields(config, ['stringField', 'numberField', 'boolField', 'nullField', 'objectField']);

      expect(isEncrypted(encrypted.stringField)).toBe(true);
      expect(encrypted.numberField).toBe(123);
      expect(encrypted.boolField).toBe(true);
      expect(encrypted.nullField).toBe(null);
      expect(encrypted.objectField).toEqual({ nested: 'value' });
    });

    it('should handle missing fields gracefully', () => {
      const config = {
        existingField: 'value',
      };

      const encrypted = encryptConfigFields(config, ['existingField', 'missingField']);
      expect(isEncrypted(encrypted.existingField)).toBe(true);
      expect(encrypted.missingField).toBeUndefined();
    });
  });

  describe('decryptConfigFields', () => {
    it('should be a no-op on non-encrypted values', () => {
      const config = {
        botToken: 'plain-text-token',
        signingSecret: 'plain-text-secret',
      };

      const result = decryptConfigFields(config, ['botToken', 'signingSecret']);

      expect(result.botToken).toBe('plain-text-token');
      expect(result.signingSecret).toBe('plain-text-secret');
    });

    it('should decrypt only encrypted fields', () => {
      const config = {
        botToken: encryptField('encrypted-token'),
        signingSecret: 'plain-text-secret',
        otherField: 'unchanged',
      };

      const result = decryptConfigFields(config, ['botToken', 'signingSecret']);

      expect(result.botToken).toBe('encrypted-token');
      expect(result.signingSecret).toBe('plain-text-secret');
      expect(result.otherField).toBe('unchanged');
    });

    it('should handle missing fields', () => {
      const config = {
        existingField: encryptField('value'),
      };

      const result = decryptConfigFields(config, ['existingField', 'missingField']);
      expect(result.existingField).toBe('value');
      expect(result.missingField).toBeUndefined();
    });
  });

  describe('maskSecret', () => {
    it('should mask secrets with last 4 characters visible', () => {
      expect(maskSecret('xoxb-abc-123456789')).toBe('••••••••6789');
      expect(maskSecret('secret-key-abcd')).toBe('••••••••abcd');
    });

    it('should handle short secrets', () => {
      expect(maskSecret('abc')).toBe('••••••••');
      expect(maskSecret('ab')).toBe('••••••••');
      expect(maskSecret('')).toBe('••••••••');
    });

    it('should handle exactly 4 characters', () => {
      expect(maskSecret('1234')).toBe('••••••••1234');
    });

    it('should handle long secrets correctly', () => {
      const longSecret = 'xoxb-' + 'a'.repeat(100) + '9876';
      expect(maskSecret(longSecret)).toBe('••••••••9876');
    });
  });
});
