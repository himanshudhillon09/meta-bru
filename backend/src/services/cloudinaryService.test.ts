import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const { jpegUrlFor } = await import('./cloudinaryService.js');

test('builds a JPEG delivery URL for the owning user cloud', () => {
    const url = jpegUrlFor('my-cloud', 'meta-bru/user-123/image');

    assert.match(url, /^https:\/\/res\.cloudinary\.com\/my-cloud\//);
    assert.match(url, /meta-bru\/user-123\/image\.jpg/);
});
