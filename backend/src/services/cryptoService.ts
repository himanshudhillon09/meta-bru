import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getKey(): Buffer {
    const key = Buffer.from(env.tokenEncryptionKey, 'hex');
    if (key.length !== 32) {
        throw new Error('TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
    }
    return key;
}

/**
 * Encrypts a secret (a Page access token or a per-user credential blob) for
 * storage. Format: iv.tag.ciphertext, each base64 encoded.
 */
export function encryptSecret(plainText: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, getKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString('base64')}`;
}

export function decryptSecret(payload: string): string {
    const [ivPart, tagPart, cipherPart] = payload.split('.');
    if (!ivPart || !tagPart || !cipherPart) {
        throw new Error('Invalid encrypted secret format');
    }

    const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivPart, 'base64'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
    const plainText = Buffer.concat([
        decipher.update(Buffer.from(cipherPart, 'base64')),
        decipher.final(),
    ]);
    return plainText.toString('utf8');
}
