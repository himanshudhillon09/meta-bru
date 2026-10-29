import { v2 as cloudinary } from 'cloudinary';
import { Post, type PostStatus } from '../models/postModel.js';
import { AppError } from '../utils/errors.js';
import {
    getCloudinaryCredentials,
    type CloudinaryCredentials,
} from './credentialService.js';

const FOLDER_ROOT = 'meta-bru';
const MAX_ASSETS = 2000;
const DELETE_BATCH_SIZE = 100;
export const MAX_DELETE_IDS = 500;

const PROTECTED_POST_STATUSES: ReadonlySet<PostStatus> = new Set([
    'draft',
    'queued',
    'publishing',
    'failed',
    'partial',
]);

export type DuplicateMatch = 'exact' | 'likely' | '';

export interface StoragePostUsage {
    id: string;
    status: PostStatus;
    caption: string;
    publishedAt: string | null;
    platforms: { facebook: boolean; instagram: boolean };
}

export interface StorageAssetBase {
    assetId: string;
    publicId: string;
    assetFolder: string;
    url: string;
    secureUrl: string;
    thumbnailUrl: string;
    format: string;
    width: number;
    height: number;
    bytes: number;
    createdAt: string;
    etag: string;
}

export interface StorageAsset extends StorageAssetBase {
    duplicateGroup: string;
    duplicateCount: number;
    duplicateMatch: DuplicateMatch;
    recommendedKeep: boolean;
    posts: StoragePostUsage[];
    canDelete: boolean;
    deleteBlockedReason: string;
}

export interface CloudinaryAccountUsage {
    plan: string;
    storageUsed: number;
    storageLimit: number;
    storagePercent: number;
    bandwidthUsed: number;
    bandwidthLimit: number;
    resources: number;
    lastUpdated: string;
    error: string;
}

export interface StorageSummary {
    account: CloudinaryAccountUsage;
    folder: {
        assetCount: number;
        bytes: number;
        truncated: boolean;
    };
    duplicates: {
        groups: number;
        extraAssets: number;
        extraBytes: number;
        exactGroups: number;
        likelyGroups: number;
    };
    unused: {
        assets: number;
        bytes: number;
    };
    protected: {
        assets: number;
        bytes: number;
    };
}

export interface StorageOverview {
    configured: boolean;
    assets: StorageAsset[];
    summary: StorageSummary;
}

export interface DeleteMediaResult {
    deleted: Array<{ assetId: string; publicId: string; bytes: number }>;
    blocked: Array<{ assetId: string; publicId: string; reason: string }>;
    skipped: Array<{ assetId: string; reason: string }>;
    freedBytes: number;
}

interface AssetListResult {
    assets: StorageAssetBase[];
    truncated: boolean;
}

interface RawAsset {
    asset_id?: unknown;
    public_id?: unknown;
    asset_folder?: unknown;
    url?: unknown;
    secure_url?: unknown;
    format?: unknown;
    width?: unknown;
    height?: unknown;
    bytes?: unknown;
    created_at?: unknown;
    etag?: unknown;
}

interface AssetListPage {
    resources?: RawAsset[];
    next_cursor?: unknown;
}

interface PostUsageRecord {
    _id: unknown;
    mediaPublicId?: string;
    status?: PostStatus;
    caption?: string;
    publishedAt?: Date | string | null;
    platforms?: { facebook?: boolean; instagram?: boolean };
}

interface DuplicateInfo {
    group: string;
    count: number;
    match: Exclude<DuplicateMatch, ''>;
    keep: boolean;
}

export interface DeletionPlan {
    allowed: StorageAsset[];
    blocked: Array<{ asset: StorageAsset; reason: string }>;
    skipped: Array<{ assetId: string; reason: string }>;
}

export type DeleteBatch = (assetIds: string[]) => Promise<unknown>;

export function userFolder(userId: string): string {
    return `${FOLDER_ROOT}/${userId}`;
}

export function userFolderPrefix(userId: string): string {
    return `${userFolder(userId)}/`;
}

/**
 * Every storage operation is scoped to the authenticated user's own folder.
 * This check is the final safety net before an asset can be listed or deleted.
 */
export function isAssetInUserFolder(
    asset: { publicId?: string; assetFolder?: string },
    userId: string
): boolean {
    const folder = userFolder(userId);
    const prefix = `${folder}/`;

    if (typeof asset.publicId === 'string' && asset.publicId.startsWith(prefix)) {
        return true;
    }

    if (typeof asset.assetFolder === 'string') {
        return (
            asset.assetFolder === folder ||
            asset.assetFolder.startsWith(prefix)
        );
    }

    return false;
}

export function thumbnailUrlFor(cloudName: string, publicId: string): string {
    return cloudinary.url(publicId, {
        cloud_name: cloudName,
        secure: true,
        width: 480,
        height: 480,
        crop: 'fill',
        quality: 'auto',
        fetch_format: 'auto',
    });
}

export function credentialsOptions(
    credentials: CloudinaryCredentials
): Record<string, string> {
    return {
        cloud_name: credentials.cloudName,
        api_key: credentials.apiKey,
        api_secret: credentials.apiSecret,
    };
}

function numberOrZero(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function isoOrNull(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function timeValue(value: string): number {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
}

interface CloudinaryErrorShape {
    message?: string;
    http_code?: number;
    error?: { message?: string };
}

function cloudinaryErrorInfo(error: unknown): {
    message: string;
    status?: number;
} {
    if (!error || typeof error !== 'object') {
        return { message: 'Cloudinary request failed.' };
    }

    const shape = error as CloudinaryErrorShape;
    const status =
        typeof shape.http_code === 'number' ? shape.http_code : undefined;
    const raw =
        shape.error?.message ||
        shape.message ||
        'Cloudinary request failed.';

    const message =
        status === 401 || status === 403
            ? 'Cloudinary rejected your credentials. Check your Cloudinary API key and secret under Profile.'
            : raw;

    if (status === undefined) return { message };
    return { message, status };
}

export function cloudinaryErrorMessage(error: unknown): string {
    return cloudinaryErrorInfo(error).message;
}

/** The HTTP status of a Cloudinary SDK error, which nests it under `error`. */
export function cloudinaryHttpCode(error: unknown): number | undefined {
    const shape = error as
        | { http_code?: unknown; error?: { http_code?: unknown } }
        | null
        | undefined;
    const code = shape?.error?.http_code ?? shape?.http_code;
    return typeof code === 'number' ? code : undefined;
}

function asCloudinaryError(error: unknown): AppError {
    return new AppError(502, cloudinaryErrorMessage(error), 'CLOUDINARY_API_FAILED');
}

function emptyAccountUsage(error = ''): CloudinaryAccountUsage {
    return {
        plan: '',
        storageUsed: 0,
        storageLimit: 0,
        storagePercent: 0,
        bandwidthUsed: 0,
        bandwidthLimit: 0,
        resources: 0,
        lastUpdated: '',
        error,
    };
}

export function emptyStorageSummary(): StorageSummary {
    return {
        account: emptyAccountUsage(),
        folder: { assetCount: 0, bytes: 0, truncated: false },
        duplicates: {
            groups: 0,
            extraAssets: 0,
            extraBytes: 0,
            exactGroups: 0,
            likelyGroups: 0,
        },
        unused: { assets: 0, bytes: 0 },
        protected: { assets: 0, bytes: 0 },
    };
}

export function normalizeAccountUsage(raw: unknown): CloudinaryAccountUsage {
    const record =
        raw && typeof raw === 'object'
            ? (raw as Record<string, unknown>)
            : {};
    const storage =
        record.storage && typeof record.storage === 'object'
            ? (record.storage as Record<string, unknown>)
            : {};
    const bandwidth =
        record.bandwidth && typeof record.bandwidth === 'object'
            ? (record.bandwidth as Record<string, unknown>)
            : {};

    const used = numberOrZero(storage.usage);
    const limit = numberOrZero(storage.limit);
    const rawPercent =
        numberOrZero(storage.used_percent) ||
        (limit > 0 ? (used / limit) * 100 : 0);

    return {
        plan: typeof record.plan === 'string' ? record.plan : '',
        storageUsed: used,
        storageLimit: limit,
        storagePercent: Math.max(0, Math.min(100, rawPercent)),
        bandwidthUsed: numberOrZero(bandwidth.usage),
        bandwidthLimit: numberOrZero(bandwidth.limit),
        resources: numberOrZero(record.resources),
        lastUpdated:
            typeof record.last_updated === 'string'
                ? record.last_updated
                : '',
        error: '',
    };
}

export function normalizeAsset(
    raw: RawAsset,
    cloudName: string
): StorageAssetBase | null {
    const publicId =
        typeof raw.public_id === 'string' ? raw.public_id : '';
    const assetId = typeof raw.asset_id === 'string' ? raw.asset_id : '';

    if (!publicId || !assetId) return null;

    return {
        assetId,
        publicId,
        assetFolder:
            typeof raw.asset_folder === 'string' ? raw.asset_folder : '',
        url: typeof raw.url === 'string' ? raw.url : '',
        secureUrl:
            typeof raw.secure_url === 'string' ? raw.secure_url : '',
        thumbnailUrl: thumbnailUrlFor(cloudName, publicId),
        format: typeof raw.format === 'string' ? raw.format : '',
        width: numberOrZero(raw.width),
        height: numberOrZero(raw.height),
        bytes: numberOrZero(raw.bytes),
        createdAt:
            typeof raw.created_at === 'string' ? raw.created_at : '',
        etag: typeof raw.etag === 'string' ? raw.etag : '',
    };
}

function normalizePage(
    raw: unknown,
    cloudName: string
): { assets: StorageAssetBase[]; nextCursor: string } {
    const page =
        raw && typeof raw === 'object' ? (raw as AssetListPage) : {};
    const resources = Array.isArray(page.resources) ? page.resources : [];
    const assets: StorageAssetBase[] = [];

    for (const resource of resources) {
        const asset = normalizeAsset(resource, cloudName);
        if (asset) assets.push(asset);
    }

    return {
        assets,
        nextCursor:
            typeof page.next_cursor === 'string' ? page.next_cursor : '',
    };
}

async function searchUserAssets(
    credentials: CloudinaryCredentials,
    userId: string,
    cap: number,
    includeImageAnalysis: boolean
): Promise<AssetListResult> {
    const folder = userFolder(userId);
    const expression = `(public_id:${folder}/* OR asset_folder=${folder}) AND resource_type:image AND type:upload`;
    const assets: StorageAssetBase[] = [];
    let cursor = '';
    let truncated = false;

    do {
        const search = cloudinary.search
            .expression(expression)
            .sort_by('created_at', 'desc')
            .max_results(500);

        // image_analysis includes the etag used for exact duplicate
        // detection. Some plans reject this field, so the caller retries
        // without it before falling back to the Admin API.
        if (includeImageAnalysis) {
            search.with_field('image_analysis');
        }
        if (cursor) search.next_cursor(cursor);

        // The SDK types omit the options argument even though the runtime
        // supports it. Per-call credentials keep each user isolated.
        const raw = await (
            search as unknown as {
                execute: (options?: Record<string, string>) => Promise<unknown>;
            }
        ).execute(credentialsOptions(credentials));

        const page = normalizePage(raw, credentials.cloudName);
        assets.push(
            ...page.assets.filter((asset) =>
                isAssetInUserFolder(asset, userId)
            )
        );
        cursor = page.nextCursor;

        if (assets.length >= cap) {
            truncated = Boolean(cursor);
            break;
        }
    } while (cursor);

    return { assets: assets.slice(0, cap), truncated };
}

async function listUserAssetsByFolder(
    credentials: CloudinaryCredentials,
    userId: string,
    cap: number
): Promise<AssetListResult> {
    const folder = userFolder(userId);
    const assets: StorageAssetBase[] = [];
    let cursor = '';
    let truncated = false;

    do {
        const options: Record<string, unknown> = {
            ...credentialsOptions(credentials),
            max_results: 500,
        };
        if (cursor) options.next_cursor = cursor;

        const raw = await cloudinary.api.resources_by_asset_folder(
            folder,
            options
        );
        const page = normalizePage(raw, credentials.cloudName);
        assets.push(
            ...page.assets.filter((asset) =>
                isAssetInUserFolder(asset, userId)
            )
        );
        cursor = page.nextCursor;

        if (assets.length >= cap) {
            truncated = Boolean(cursor);
            break;
        }
    } while (cursor);

    return { assets: assets.slice(0, cap), truncated };
}

async function listUserAssetsByPrefix(
    credentials: CloudinaryCredentials,
    userId: string,
    cap: number
): Promise<AssetListResult> {
    const prefix = userFolderPrefix(userId);
    const assets: StorageAssetBase[] = [];
    let cursor = '';
    let truncated = false;

    do {
        const options: Record<string, unknown> = {
            ...credentialsOptions(credentials),
            resource_type: 'image',
            type: 'upload',
            prefix,
            max_results: 500,
        };
        if (cursor) options.next_cursor = cursor;

        const raw = await cloudinary.api.resources(options);
        const page = normalizePage(raw, credentials.cloudName);
        assets.push(
            ...page.assets.filter((asset) =>
                isAssetInUserFolder(asset, userId)
            )
        );
        cursor = page.nextCursor;

        if (assets.length >= cap) {
            truncated = Boolean(cursor);
            break;
        }
    } while (cursor);

    return { assets: assets.slice(0, cap), truncated };
}

async function listUserAssets(
    credentials: CloudinaryCredentials,
    userId: string,
    cap = MAX_ASSETS
): Promise<AssetListResult> {
    let lastError: unknown;

    try {
        const result = await searchUserAssets(
            credentials,
            userId,
            cap,
            true
        );
        if (result.assets.length > 0) return result;
    } catch (error) {
        lastError = error;
    }

    try {
        const result = await searchUserAssets(
            credentials,
            userId,
            cap,
            false
        );
        if (result.assets.length > 0) return result;
    } catch (error) {
        lastError = error;
    }

    try {
        const result = await listUserAssetsByFolder(credentials, userId, cap);
        if (result.assets.length > 0) return result;
    } catch (error) {
        lastError = error;
    }

    try {
        return await listUserAssetsByPrefix(credentials, userId, cap);
    } catch (error) {
        lastError = error;
    }

    if (lastError) throw lastError;
    return { assets: [], truncated: false };
}

async function getAccountUsage(
    credentials: CloudinaryCredentials
): Promise<CloudinaryAccountUsage> {
    try {
        const raw = await cloudinary.api.usage(credentialsOptions(credentials));
        return normalizeAccountUsage(raw);
    } catch (error) {
        return emptyAccountUsage(cloudinaryErrorMessage(error));
    }
}

async function loadPostUsage(
    userId: string,
    publicIds: string[]
): Promise<Map<string, StoragePostUsage[]>> {
    const usage = new Map<string, StoragePostUsage[]>();
    if (publicIds.length === 0) return usage;

    const posts = await Post.find({
        userId,
        mediaPublicId: { $in: publicIds },
    })
        .select('_id mediaPublicId status caption platforms publishedAt')
        .lean<PostUsageRecord[]>();

    for (const post of posts) {
        const publicId =
            typeof post.mediaPublicId === 'string' ? post.mediaPublicId : '';
        if (!publicId || !post.status) continue;

        const list = usage.get(publicId) ?? [];
        list.push({
            id: String(post._id),
            status: post.status,
            caption: typeof post.caption === 'string' ? post.caption : '',
            publishedAt: isoOrNull(post.publishedAt),
            platforms: {
                facebook: Boolean(post.platforms?.facebook),
                instagram: Boolean(post.platforms?.instagram),
            },
        });
        usage.set(publicId, list);
    }

    return usage;
}

export function duplicateKeyFor(
    asset: Pick<
        StorageAssetBase,
        'etag' | 'bytes' | 'width' | 'height' | 'format'
    >
): { key: string; match: Exclude<DuplicateMatch, ''> } | null {
    const etag = asset.etag.trim();
    if (etag) {
        return { key: `etag:${etag}`, match: 'exact' };
    }

    if (
        asset.bytes > 0 &&
        asset.width > 0 &&
        asset.height > 0 &&
        asset.format
    ) {
        return {
            key: `shape:${asset.bytes}:${asset.width}:${asset.height}:${asset.format.toLowerCase()}`,
            match: 'likely',
        };
    }

    return null;
}

export function applyDuplicateGroups(
    assets: StorageAssetBase[],
    postUsage: Map<string, StoragePostUsage[]>
): StorageAsset[] {
    const groups = new Map<
        string,
        { match: Exclude<DuplicateMatch, ''>; assets: StorageAssetBase[] }
    >();

    for (const asset of assets) {
        const key = duplicateKeyFor(asset);
        if (!key) continue;

        const existing = groups.get(key.key);
        if (existing) {
            existing.assets.push(asset);
        } else {
            groups.set(key.key, { match: key.match, assets: [asset] });
        }
    }

    const info = new Map<string, DuplicateInfo>();
    for (const [key, group] of groups) {
        if (group.assets.length < 2) continue;

        const sorted = [...group.assets].sort((a, b) => {
            const aUsed =
                (postUsage.get(a.publicId)?.length ?? 0) > 0 ? 0 : 1;
            const bUsed =
                (postUsage.get(b.publicId)?.length ?? 0) > 0 ? 0 : 1;
            if (aUsed !== bUsed) return aUsed - bUsed;
            return timeValue(a.createdAt) - timeValue(b.createdAt);
        });

        sorted.forEach((asset, index) => {
            info.set(asset.assetId, {
                group: key,
                count: sorted.length,
                match: group.match,
                keep: index === 0,
            });
        });
    }

    return assets.map((asset) => {
        const posts = postUsage.get(asset.publicId) ?? [];
        const duplicate = info.get(asset.assetId);
        const protectedPost = posts.find((post) =>
            PROTECTED_POST_STATUSES.has(post.status)
        );

        return {
            ...asset,
            duplicateGroup: duplicate?.group ?? '',
            duplicateCount: duplicate?.count ?? 1,
            duplicateMatch: duplicate?.match ?? '',
            recommendedKeep: duplicate ? duplicate.keep : true,
            posts,
            canDelete: !protectedPost,
            deleteBlockedReason: protectedPost
                ? `Used by a ${protectedPost.status} post. Publish or remove that post first.`
                : '',
        };
    });
}

export function summarizeStorage(
    assets: StorageAsset[],
    account: CloudinaryAccountUsage,
    truncated: boolean
): StorageSummary {
    let folderBytes = 0;
    let unusedAssets = 0;
    let unusedBytes = 0;
    let protectedAssets = 0;
    let protectedBytes = 0;
    let extraAssets = 0;
    let extraBytes = 0;
    let exactGroups = 0;
    let likelyGroups = 0;
    const seenGroups = new Set<string>();

    for (const asset of assets) {
        folderBytes += asset.bytes;

        if (asset.posts.length === 0) {
            unusedAssets += 1;
            unusedBytes += asset.bytes;
        }

        if (!asset.canDelete) {
            protectedAssets += 1;
            protectedBytes += asset.bytes;
        }

        if (asset.duplicateGroup) {
            if (!seenGroups.has(asset.duplicateGroup)) {
                seenGroups.add(asset.duplicateGroup);
                if (asset.duplicateMatch === 'exact') exactGroups += 1;
                else if (asset.duplicateMatch === 'likely') likelyGroups += 1;
            }

            if (!asset.recommendedKeep) {
                extraAssets += 1;
                extraBytes += asset.bytes;
            }
        }
    }

    return {
        account,
        folder: {
            assetCount: assets.length,
            bytes: folderBytes,
            truncated,
        },
        duplicates: {
            groups: exactGroups + likelyGroups,
            extraAssets,
            extraBytes,
            exactGroups,
            likelyGroups,
        },
        unused: { assets: unusedAssets, bytes: unusedBytes },
        protected: { assets: protectedAssets, bytes: protectedBytes },
    };
}

async function loadOwnedAssets(
    credentials: CloudinaryCredentials,
    userId: string
): Promise<AssetListResult & { assets: StorageAsset[] }> {
    let listed: AssetListResult;

    try {
        listed = await listUserAssets(credentials, userId);
    } catch (error) {
        throw asCloudinaryError(error);
    }

    const postUsage = await loadPostUsage(
        userId,
        listed.assets.map((asset) => asset.publicId)
    );

    return {
        assets: applyDuplicateGroups(listed.assets, postUsage),
        truncated: listed.truncated,
    };
}

export async function getStorageOverviewForUser(
    userId: string
): Promise<StorageOverview> {
    const credentials = await getCloudinaryCredentials(userId);

    const [listed, account] = await Promise.all([
        loadOwnedAssets(credentials, userId),
        getAccountUsage(credentials),
    ]);

    return {
        configured: true,
        assets: listed.assets,
        summary: summarizeStorage(
            listed.assets,
            account,
            listed.truncated
        ),
    };
}

export function planDeletion(
    assets: StorageAsset[],
    requestedIds: string[]
): DeletionPlan {
    const byId = new Map(
        assets.map((asset) => [asset.assetId, asset] as const)
    );
    const seen = new Set<string>();
    const allowed: StorageAsset[] = [];
    const blocked: DeletionPlan['blocked'] = [];
    const skipped: DeletionPlan['skipped'] = [];

    for (const raw of requestedIds) {
        if (typeof raw !== 'string') continue;

        const assetId = raw.trim();
        if (!assetId || seen.has(assetId)) continue;
        seen.add(assetId);

        const asset = byId.get(assetId);
        if (!asset) {
            skipped.push({
                assetId,
                reason: 'Asset not found in your Meta-Bru folder.',
            });
            continue;
        }

        if (!asset.canDelete) {
            blocked.push({
                asset,
                reason:
                    asset.deleteBlockedReason ||
                    'Asset is used by an unfinished post.',
            });
            continue;
        }

        allowed.push(asset);
    }

    return { allowed, blocked, skipped };
}

interface DeleteApiResponse {
    deleted?: Record<string, unknown>;
}

export async function executeDeletion(
    credentials: CloudinaryCredentials,
    plan: DeletionPlan,
    deleteBatch: DeleteBatch = (assetIds) =>
        // CDN invalidation requires account-level enablement and is not
        // needed to free storage, so it is intentionally omitted here.
        cloudinary.api.delete_resources_by_asset_ids(
            assetIds,
            credentialsOptions(credentials)
        )
): Promise<DeleteMediaResult> {
    const deleted: DeleteMediaResult['deleted'] = [];
    const blocked = plan.blocked.map(({ asset, reason }) => ({
        assetId: asset.assetId,
        publicId: asset.publicId,
        reason,
    }));
    const skipped = [...plan.skipped];
    let freedBytes = 0;

    for (
        let index = 0;
        index < plan.allowed.length;
        index += DELETE_BATCH_SIZE
    ) {
        const batch = plan.allowed.slice(index, index + DELETE_BATCH_SIZE);

        try {
            const response = (await deleteBatch(
                batch.map((asset) => asset.assetId)
            )) as DeleteApiResponse;
            const result = response.deleted ?? {};

            for (const asset of batch) {
                const status =
                    result[asset.assetId] ?? result[asset.publicId];

                if (status === 'deleted') {
                    deleted.push({
                        assetId: asset.assetId,
                        publicId: asset.publicId,
                        bytes: asset.bytes,
                    });
                    freedBytes += asset.bytes;
                } else if (status === 'not_found') {
                    skipped.push({
                        assetId: asset.assetId,
                        reason: 'Asset was already removed from Cloudinary.',
                    });
                } else {
                    skipped.push({
                        assetId: asset.assetId,
                        reason:
                            typeof status === 'string'
                                ? `Cloudinary returned: ${status}`
                                : 'Cloudinary did not confirm deletion.',
                    });
                }
            }
        } catch (error) {
            const reason = cloudinaryErrorMessage(error);
            for (const asset of batch) {
                skipped.push({ assetId: asset.assetId, reason });
            }
        }
    }

    return { deleted, blocked, skipped, freedBytes };
}

export async function deleteUserAssets(
    userId: string,
    assetIds: string[]
): Promise<DeleteMediaResult> {
    if (assetIds.length === 0) {
        throw new AppError(
            400,
            'Select at least one image to delete.',
            'VALIDATION_ERROR'
        );
    }

    if (assetIds.length > MAX_DELETE_IDS) {
        throw new AppError(
            400,
            `You can delete at most ${MAX_DELETE_IDS} images at a time.`,
            'VALIDATION_ERROR'
        );
    }

    const credentials = await getCloudinaryCredentials(userId);
    const owned = await loadOwnedAssets(credentials, userId);
    const plan = planDeletion(owned.assets, assetIds);

    return executeDeletion(credentials, plan);
}
