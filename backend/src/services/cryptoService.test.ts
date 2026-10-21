import test from 'node:test';
import assert from 'node:assert/strict';

// Ensure the config module reads deterministic test values instead of the
// developer's .env file.
process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const { encryptSecret, decryptSecret } = await import('./cryptoService.js');

test('encrypts and decrypts a token round-trip', () => {
    const token = 'EAABsbCS1iHgBO7ZC9example-token-value';

    const encrypted = encryptSecret(token);

    assert.notEqual(encrypted, token);
    assert.equal(decryptSecret(encrypted), token);
});

test('uses a fresh IV for every encryption', () => {
    const token = 'same-token';

    const first = encryptSecret(token);
    const second = encryptSecret(token);

    assert.notEqual(first, second);
    assert.equal(decryptSecret(first), token);
    assert.equal(decryptSecret(second), token);
});

test('rejects tampered ciphertext', () => {
    const encrypted = encryptSecret('sensitive-page-token');
    const [iv, tag, ciphertext] = encrypted.split('.');

    assert.ok(iv && tag && ciphertext);

    const tampered = `${iv}.${tag}.${ciphertext.slice(0, -2)}AA`;

    assert.throws(() => decryptSecret(tampered));
});

test('rejects malformed payloads', () => {
    assert.throws(() => decryptSecret('not-a-valid-payload'), /Invalid encrypted secret/);
    assert.throws(() => decryptSecret('a.b'), /Invalid encrypted secret/);
});
