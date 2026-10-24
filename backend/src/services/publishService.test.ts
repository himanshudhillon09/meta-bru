import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const { publishPost } = await import('./publishService.js');
const { SocialConnection } = await import('../models/socialConnectionModel.js');
const { User } = await import('../models/userModel.js');

const USER_ID = '64b7f1c2a1b2c3d4e5f60719';
const CONNECTION_ID = '64b7f1c2a1b2c3d4e5f60718';

afterEach(() => mock.restoreAll());

test('publishPost does not mark a disconnected Page as needs_reauth', async () => {
    const connection = {
        _id: { toString: () => CONNECTION_ID },
        tokenStatus: 'disconnected',
        pageAccessTokenEnc: '',
    };
    const post = {
        userId: USER_ID,
        platforms: { facebook: true, instagram: false },
        targets: [],
        status: 'queued',
        lastError: '',
        save: async () => post,
    };

    // No Meta credentials -> publishPost takes the META_NOT_CONFIGURED branch,
    // which calls markConnectionNeedsReauth.
    mock.method(User, 'findById', () => ({
        select: async () => ({ credentialsEnc: '' }),
    }));

    let capturedFilter: Record<string, unknown> | undefined;
    mock.method(SocialConnection, 'updateOne', (filter: unknown) => {
        capturedFilter = filter as Record<string, unknown>;
        return { matchedCount: 0 };
    });

    await publishPost(post as never, connection as never);

    assert.equal(connection.tokenStatus, 'disconnected');
    assert.ok(capturedFilter);
    assert.deepEqual(capturedFilter.tokenStatus, { $ne: 'disconnected' });
});
