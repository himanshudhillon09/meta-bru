import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const { encryptSecret } = await import('./cryptoService.js');
const { parseCredentialStore } = await import('./credentialService.js');

test('round-trips a complete per-user credential store', () => {
    const store = {
        meta: {
            appId: '123456789012345',
            appSecret: 'abcdef0123456789abcdef0123456789',
        },
        cloudinary: {
            cloudName: 'my-cloud',
            apiKey: '123456789012345',
            apiSecret: 'cloudinary-secret',
        },
        gemini: {
            apiKey: 'gemini-api-key',
        },
    };

    const parsed = parseCredentialStore(encryptSecret(JSON.stringify(store)));

    assert.deepEqual(parsed, store);
});

test('rejects an incomplete Meta credential object', () => {
    const payload = encryptSecret(
        JSON.stringify({ meta: { appId: '123456789012345' } })
    );

    assert.throws(
        () => parseCredentialStore(payload),
        /Invalid credential field: meta.appSecret/
    );
});

test('rejects malformed encrypted payloads', () => {
    assert.throws(
        () => parseCredentialStore('not-an-encrypted-payload'),
        /Invalid encrypted credential payload/
    );
});
