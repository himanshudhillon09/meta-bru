import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type {
    DeletionPlan,
    StorageAsset,
    StorageAssetBase,
    StoragePostUsage,
} from './cloudinaryStorageService.js';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const {
    applyDuplicateGroups,
    deletePostMediaIfUnused,
    duplicateKeyFor,
    emptyStorageSummary,
    executeDeletion,
    isAssetInUserFolder,
    normalizeAccountUsage,
    normalizeAsset,
    planDeletion,
    summarizeStorage,
    thumbnailUrlFor,
    userFolder,
} = await import('./cloudinaryStorageService.js');
const { reelCoverUrl } = await import('./mediaDerivativeService.js');
const { Post } = await import('../models/postModel.js');
const { User } = await import('../models/userModel.js');
const { encryptSecret } = await import('./cryptoService.js');

type MockableModel = Record<string, (...args: unknown[]) => unknown>;
const postModel = Post as unknown as MockableModel;
const userModel = User as unknown as MockableModel;
const OWNER_ID = '64b7f1c2a1b2c3d4e5f60719';

afterEach(() => mock.restoreAll());

function cloudinaryOwner() {
    return {
        select: async () => ({
            credentialsEnc: encryptSecret(
                JSON.stringify({
                    cloudinary: { cloudName: 'demo', apiKey: 'key', apiSecret: 'secret' },
                })
            ),
        }),
    };
}

function fakeFileStore(assetFolder: string | null, removeError?: Error) {
    const removed: Array<[string, string]> = [];
    return {
        removed,
        storeFor: () => ({
            assetFolder: async () => assetFolder,
            remove: async (publicId: string, resourceType: string) => {
                if (removeError) throw removeError;
                removed.push([publicId, resourceType]);
            },
        }),
    };
}

function baseAsset(
    overrides: Partial<StorageAssetBase> = {}
): StorageAssetBase {
    return {
        assetId: 'asset-1',
        publicId: 'meta-bru/user-1/image-1',
        assetFolder: 'meta-bru/user-1',
        url: 'http://res.cloudinary.com/demo/image/upload/image-1.jpg',
        secureUrl:
            'https://res.cloudinary.com/demo/image/upload/image-1.jpg',
        thumbnailUrl:
            'https://res.cloudinary.com/demo/image/upload/c_fill,w_480,h_480/image-1.jpg',
        format: 'jpg',
        width: 1080,
        height: 1080,
        bytes: 1000,
        createdAt: '2026-01-01T00:00:00.000Z',
        etag: 'etag-1',
        resourceType: 'image',
        duration: 0,
        ...overrides,
    };
}

function storageAsset(
    overrides: Partial<StorageAsset> = {}
): StorageAsset {
    return {
        ...baseAsset(),
        duplicateGroup: '',
        duplicateCount: 1,
        duplicateMatch: '',
        recommendedKeep: true,
        posts: [],
        canDelete: true,
        deleteBlockedReason: '',
        ...overrides,
    };
}

function postUsage(
    status: StoragePostUsage['status'],
    id = 'post-1'
): StoragePostUsage {
    return {
        id,
        status,
        caption: 'A test caption',
        publishedAt: null,
        platforms: { facebook: true, instagram: false },
    };
}

test('scopes assets to the authenticated user folder', () => {
    assert.equal(userFolder('user-1'), 'meta-bru/user-1');

    assert.equal(
        isAssetInUserFolder(
            { publicId: 'meta-bru/user-1/image.jpg' },
            'user-1'
        ),
        true
    );
    assert.equal(
        isAssetInUserFolder({ assetFolder: 'meta-bru/user-1' }, 'user-1'),
        true
    );
    assert.equal(
        isAssetInUserFolder(
            { publicId: 'meta-bru/user-10/image.jpg' },
            'user-1'
        ),
        false
    );
    assert.equal(
        isAssetInUserFolder({ assetFolder: 'meta-bru/user-10' }, 'user-1'),
        false
    );
    assert.equal(isAssetInUserFolder({}, 'user-1'), false);
});

test('builds a thumbnail URL for the owning cloud', () => {
    const url = thumbnailUrlFor('my-cloud', 'meta-bru/user-1/image');

    assert.match(url, /^https:\/\/res\.cloudinary\.com\/my-cloud\//);
    assert.match(url, /c_fill/);
    assert.match(url, /w_480/);
});

test('detects exact and likely duplicate keys', () => {
    assert.deepEqual(duplicateKeyFor(baseAsset()), {
        key: 'etag:etag-1',
        match: 'exact',
    });

    assert.deepEqual(duplicateKeyFor(baseAsset({ etag: '' })), {
        key: 'shape:1000:1080:1080:jpg',
        match: 'likely',
    });

    assert.equal(
        duplicateKeyFor(baseAsset({ etag: '', width: 0 })),
        null
    );
});

test('groups exact duplicates and keeps the in-use copy', () => {
    const used = baseAsset({
        assetId: 'used',
        publicId: 'meta-bru/user-1/used',
        createdAt: '2026-02-01T00:00:00.000Z',
    });
    const unused = baseAsset({
        assetId: 'unused',
        publicId: 'meta-bru/user-1/unused',
        createdAt: '2026-01-01T00:00:00.000Z',
    });

    const assets = applyDuplicateGroups(
        [used, unused],
        new Map([
            ['meta-bru/user-1/used', [postUsage('published')]],
        ])
    );

    const usedAsset = assets.find((asset) => asset.assetId === 'used');
    const unusedAsset = assets.find((asset) => asset.assetId === 'unused');

    assert.ok(usedAsset);
    assert.ok(unusedAsset);
    assert.equal(usedAsset.recommendedKeep, true);
    assert.equal(unusedAsset.recommendedKeep, false);
    assert.equal(usedAsset.duplicateCount, 2);
    assert.equal(usedAsset.duplicateMatch, 'exact');
    assert.equal(usedAsset.canDelete, true);
    assert.equal(unusedAsset.canDelete, true);
});

test('labels possible duplicates and keeps the oldest copy', () => {
    const newer = baseAsset({
        assetId: 'newer',
        publicId: 'meta-bru/user-1/newer',
        etag: '',
        createdAt: '2026-02-01T00:00:00.000Z',
    });
    const older = baseAsset({
        assetId: 'older',
        publicId: 'meta-bru/user-1/older',
        etag: '',
        createdAt: '2026-01-01T00:00:00.000Z',
    });

    const assets = applyDuplicateGroups([newer, older], new Map());
    const olderAsset = assets.find((asset) => asset.assetId === 'older');
    const newerAsset = assets.find((asset) => asset.assetId === 'newer');

    assert.ok(olderAsset);
    assert.ok(newerAsset);
    assert.equal(olderAsset.recommendedKeep, true);
    assert.equal(newerAsset.recommendedKeep, false);
    assert.equal(olderAsset.duplicateMatch, 'likely');
    assert.match(olderAsset.duplicateGroup, /^shape:/);
});

test('leaves unique assets ungrouped', () => {
    const [asset] = applyDuplicateGroups([baseAsset()], new Map());

    assert.ok(asset);
    assert.equal(asset.duplicateCount, 1);
    assert.equal(asset.duplicateGroup, '');
    assert.equal(asset.recommendedKeep, true);
});

test('blocks deletion for every unfinished post status', () => {
    const statuses = [
        'draft',
        'queued',
        'publishing',
        'failed',
        'partial',
    ] as const;

    for (const status of statuses) {
        const asset = baseAsset({ assetId: status, publicId: `meta-bru/user-1/${status}` });
        const [result] = applyDuplicateGroups(
            [asset],
            new Map([[asset.publicId, [postUsage(status)]]])
        );

        assert.ok(result);
        assert.equal(result.canDelete, false, status);
        assert.match(result.deleteBlockedReason, new RegExp(status));
    }
});

test('allows deleting an image used only by published posts', () => {
    const asset = baseAsset();
    const [result] = applyDuplicateGroups(
        [asset],
        new Map([[asset.publicId, [postUsage('published')]]])
    );

    assert.ok(result);
    assert.equal(result.canDelete, true);
    assert.equal(result.deleteBlockedReason, '');
    assert.equal(result.posts.length, 1);
});

test('summarizes storage, duplicates, unused, and protected assets', () => {
    const keep = baseAsset({
        assetId: 'keep',
        publicId: 'meta-bru/user-1/keep',
        createdAt: '2026-01-01T00:00:00.000Z',
    });
    const extra = baseAsset({
        assetId: 'extra',
        publicId: 'meta-bru/user-1/extra',
        createdAt: '2026-02-01T00:00:00.000Z',
    });
    const unused = baseAsset({
        assetId: 'unused',
        publicId: 'meta-bru/user-1/unused',
        etag: 'etag-2',
        width: 500,
        height: 500,
        bytes: 500,
    });
    const protectedAsset = baseAsset({
        assetId: 'protected',
        publicId: 'meta-bru/user-1/protected',
        etag: 'etag-3',
        width: 700,
        height: 700,
        bytes: 700,
    });

    const assets = applyDuplicateGroups(
        [keep, extra, unused, protectedAsset],
        new Map([
            [keep.publicId, [postUsage('published')]],
            [protectedAsset.publicId, [postUsage('queued')]],
        ])
    );
    const account = normalizeAccountUsage({
        plan: 'Basic',
        storage: { usage: 5000, limit: 10000, used_percent: 50 },
        resources: 4,
    });
    const summary = summarizeStorage(assets, account, true);

    assert.equal(summary.folder.assetCount, 4);
    assert.equal(summary.folder.bytes, 3200);
    assert.equal(summary.folder.truncated, true);
    assert.equal(summary.duplicates.groups, 1);
    assert.equal(summary.duplicates.exactGroups, 1);
    assert.equal(summary.duplicates.likelyGroups, 0);
    assert.equal(summary.duplicates.extraAssets, 1);
    assert.equal(summary.duplicates.extraBytes, 1000);
    assert.equal(summary.unused.assets, 2);
    assert.equal(summary.unused.bytes, 1500);
    assert.equal(summary.protected.assets, 1);
    assert.equal(summary.protected.bytes, 700);
});

test('normalizes Cloudinary account usage', () => {
    const usage = normalizeAccountUsage({
        plan: 'Basic',
        storage: { usage: 500, limit: 1000, used_percent: 50 },
        bandwidth: { usage: 100, limit: 2000 },
        resources: 3,
        last_updated: '2026-10-24',
    });

    assert.deepEqual(usage, {
        plan: 'Basic',
        storageUsed: 500,
        storageLimit: 1000,
        storagePercent: 50,
        bandwidthUsed: 100,
        bandwidthLimit: 2000,
        resources: 3,
        lastUpdated: '2026-10-24',
        error: '',
    });
});

test('calculates usage percentage and tolerates malformed usage data', () => {
    const calculated = normalizeAccountUsage({
        storage: { usage: 250, limit: 1000 },
    });
    assert.equal(calculated.storagePercent, 25);

    const empty = normalizeAccountUsage(null);
    assert.equal(empty.storageUsed, 0);
    assert.equal(empty.storagePercent, 0);
    assert.equal(empty.error, '');
});

test('normalizes a Cloudinary asset and builds its thumbnail', () => {
    const asset = normalizeAsset(
        {
            asset_id: 'asset-1',
            public_id: 'meta-bru/user-1/image',
            asset_folder: 'meta-bru/user-1',
            secure_url:
                'https://res.cloudinary.com/demo/image/upload/image.jpg',
            url: 'http://res.cloudinary.com/demo/image/upload/image.jpg',
            format: 'jpg',
            width: 1080,
            height: 1080,
            bytes: 1234,
            created_at: '2026-10-24T00:00:00Z',
            etag: 'abc',
        },
        'demo'
    );

    assert.ok(asset);
    assert.equal(asset.assetId, 'asset-1');
    assert.equal(asset.publicId, 'meta-bru/user-1/image');
    assert.equal(asset.bytes, 1234);
    assert.match(
        asset.thumbnailUrl,
        /^https:\/\/res\.cloudinary\.com\/demo\//
    );
});

test('ignores assets without an asset id', () => {
    assert.equal(
        normalizeAsset({ public_id: 'meta-bru/user-1/image' }, 'demo'),
        null
    );
});

test('plans deletion only for owned, deletable assets', () => {
    const allowed = baseAsset({
        assetId: 'allowed',
        publicId: 'meta-bru/user-1/allowed',
    });
    const blocked = baseAsset({
        assetId: 'blocked',
        publicId: 'meta-bru/user-1/blocked',
        etag: 'etag-blocked',
        width: 2,
        height: 2,
        bytes: 2,
    });

    const assets = applyDuplicateGroups(
        [allowed, blocked],
        new Map([[blocked.publicId, [postUsage('queued')]]])
    );
    const plan = planDeletion(assets, [
        'allowed',
        'blocked',
        'missing',
        'allowed',
    ]);

    assert.equal(plan.allowed.length, 1);
    assert.equal(plan.allowed[0]?.assetId, 'allowed');
    assert.equal(plan.blocked.length, 1);
    assert.equal(plan.blocked[0]?.asset.assetId, 'blocked');
    assert.match(plan.blocked[0]?.reason ?? '', /queued/);
    assert.equal(plan.skipped.length, 1);
    assert.equal(plan.skipped[0]?.assetId, 'missing');
});

test('executes deletion and reports freed bytes', async () => {
    const first = storageAsset({
        assetId: 'first',
        publicId: 'meta-bru/user-1/first',
        bytes: 1000,
    });
    const second = storageAsset({
        assetId: 'second',
        publicId: 'meta-bru/user-1/second',
        bytes: 2000,
    });
    const plan: DeletionPlan = {
        allowed: [first, second],
        blocked: [],
        skipped: [],
    };

    const result = await executeDeletion(
        { cloudName: 'demo', apiKey: 'key', apiSecret: 'secret' },
        plan,
        async () => ({
            deleted: { first: 'deleted', second: 'not_found' },
        })
    );

    assert.equal(result.deleted.length, 1);
    assert.equal(result.deleted[0]?.assetId, 'first');
    assert.equal(result.freedBytes, 1000);
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0]?.reason ?? '', /already removed/);
});

test('reports skipped assets when Cloudinary rejects a batch', async () => {
    const asset = storageAsset({
        assetId: 'a',
        publicId: 'meta-bru/user-1/a',
    });
    const plan: DeletionPlan = {
        allowed: [asset],
        blocked: [],
        skipped: [],
    };

    const result = await executeDeletion(
        { cloudName: 'demo', apiKey: 'key', apiSecret: 'secret' },
        plan,
        async () => {
            throw new Error('Cloudinary is down');
        }
    );

    assert.equal(result.deleted.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0]?.reason ?? '', /Cloudinary is down/);
});

test('preserves blocked and skipped reasons', async () => {
    const blocked = storageAsset({
        assetId: 'blocked',
        publicId: 'meta-bru/user-1/blocked',
        canDelete: false,
        deleteBlockedReason: 'Used by a draft post.',
    });
    const plan: DeletionPlan = {
        allowed: [],
        blocked: [
            { asset: blocked, reason: 'Used by a draft post.' },
        ],
        skipped: [
            {
                assetId: 'missing',
                reason: 'Asset not found in your Meta-Bru folder.',
            },
        ],
    };

    const result = await executeDeletion(
        { cloudName: 'demo', apiKey: 'key', apiSecret: 'secret' },
        plan,
        async () => ({ deleted: {} })
    );

    assert.equal(result.blocked.length, 1);
    assert.equal(result.blocked[0]?.assetId, 'blocked');
    assert.equal(result.blocked[0]?.reason, 'Used by a draft post.');
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0]?.assetId, 'missing');
});

test('returns a zeroed storage summary when Cloudinary is not configured', () => {
    const summary = emptyStorageSummary();

    assert.equal(summary.account.storageUsed, 0);
    assert.equal(summary.folder.assetCount, 0);
    assert.equal(summary.duplicates.groups, 0);
    assert.equal(summary.unused.assets, 0);
    assert.equal(summary.protected.assets, 0);
});

test('normalizes a Cloudinary video with its cover as the thumbnail', () => {
    const asset = normalizeAsset(
        {
            asset_id: 'video-1',
            public_id: 'meta-bru/user-1/reel-1',
            asset_folder: 'meta-bru/user-1',
            resource_type: 'video',
            secure_url: 'https://res.cloudinary.com/demo/video/upload/reel-1.mp4',
            format: 'mp4',
            width: 1080,
            height: 1920,
            bytes: 9_000_000,
            duration: 12.5,
            created_at: '2026-10-29T00:00:00Z',
        },
        'demo'
    );

    assert.ok(asset);
    assert.equal(asset.resourceType, 'video');
    assert.equal(asset.duration, 12.5);
    assert.equal(asset.thumbnailUrl, reelCoverUrl('demo', 'meta-bru/user-1/reel-1'));
});

test('treats assets without a resource type as images', () => {
    const asset = normalizeAsset(
        { asset_id: 'asset-1', public_id: 'meta-bru/user-1/image', format: 'jpg' },
        'demo'
    );

    assert.ok(asset);
    assert.equal(asset.resourceType, 'image');
    assert.equal(asset.duration, 0);
    assert.equal(asset.thumbnailUrl, thumbnailUrlFor('demo', 'meta-bru/user-1/image'));
});

test('deletes an unused post file from the user folder', async () => {
    mock.method(postModel, 'exists', async () => null);
    mock.method(userModel, 'findById', () => cloudinaryOwner());
    const files = fakeFileStore(`meta-bru/${OWNER_ID}`);

    const result = await deletePostMediaIfUnused(
        OWNER_ID,
        { publicId: `meta-bru/${OWNER_ID}/reel-1`, resourceType: 'video' },
        files.storeFor
    );

    assert.deepEqual(result, { mediaDeleted: true, mediaError: '' });
    assert.deepEqual(files.removed, [[`meta-bru/${OWNER_ID}/reel-1`, 'video']]);
});

test('keeps a file another post still uses', async () => {
    mock.method(postModel, 'exists', async () => ({ _id: 'other-post' }));
    const files = fakeFileStore(`meta-bru/${OWNER_ID}`);

    const result = await deletePostMediaIfUnused(
        OWNER_ID,
        { publicId: `meta-bru/${OWNER_ID}/image-1`, resourceType: 'image' },
        files.storeFor
    );

    assert.deepEqual(result, { mediaDeleted: false, mediaError: '' });
    assert.deepEqual(files.removed, []);
});

test('never deletes a file outside the user folder', async () => {
    mock.method(postModel, 'exists', async () => null);
    mock.method(userModel, 'findById', () => cloudinaryOwner());
    const files = fakeFileStore('somewhere-else');

    const result = await deletePostMediaIfUnused(
        OWNER_ID,
        { publicId: 'somewhere-else/image-1', resourceType: 'image' },
        files.storeFor
    );

    assert.deepEqual(result, { mediaDeleted: false, mediaError: '' });
    assert.deepEqual(files.removed, []);
});

test('reports a Cloudinary failure instead of throwing', async () => {
    mock.method(postModel, 'exists', async () => null);
    mock.method(userModel, 'findById', () => cloudinaryOwner());
    const files = fakeFileStore(`meta-bru/${OWNER_ID}`, new Error('Cloudinary is down'));

    const result = await deletePostMediaIfUnused(
        OWNER_ID,
        { publicId: `meta-bru/${OWNER_ID}/image-1`, resourceType: 'image' },
        files.storeFor
    );

    assert.deepEqual(result, { mediaDeleted: false, mediaError: 'Cloudinary is down' });
});

test('skips cleanup quietly without Cloudinary credentials or media', async () => {
    mock.method(postModel, 'exists', async () => null);
    mock.method(userModel, 'findById', () => ({
        select: async () => ({ credentialsEnc: '' }),
    }));
    const files = fakeFileStore(`meta-bru/${OWNER_ID}`);

    assert.deepEqual(
        await deletePostMediaIfUnused(
            OWNER_ID,
            { publicId: `meta-bru/${OWNER_ID}/image-1`, resourceType: 'image' },
            files.storeFor
        ),
        { mediaDeleted: false, mediaError: '' }
    );
    assert.deepEqual(
        await deletePostMediaIfUnused(OWNER_ID, { publicId: '', resourceType: 'image' }, files.storeFor),
        { mediaDeleted: false, mediaError: '' }
    );
});
