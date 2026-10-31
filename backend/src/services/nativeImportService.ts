import type { QueryFilter } from 'mongoose';
import { ImportedPost, type IImportedPost, type ImportedKind } from '../models/importedPostModel.js';
import { Post, type IPost, type Platform } from '../models/postModel.js';
import { SocialConnection, type ISocialConnection } from '../models/socialConnectionModel.js';
import { decryptSecret } from './cryptoService.js';
import { sanitizeErrorMessage } from './metaInsightsService.js';
import { graphRequest } from './metaService.js';

/** How far back the first import reads. */
const FIRST_IMPORT_DAYS = 365;
/** Later imports re-read a few days to catch late edits and missed runs. */
const OVERLAP_DAYS = 3;
/** A Page is read again at most this often, unless the user asks. */
const IMPORT_INTERVAL_MS = 60 * 60_000;
const PAGE_SIZE = 50;
const MAX_PAGES = 10;

interface GraphList<T> {
    data?: T[];
    paging?: { next?: string; cursors?: { after?: string } };
}

interface FacebookPost {
    id: string;
    message?: string;
    created_time?: string;
    status_type?: string;
    permalink_url?: string;
    full_picture?: string;
    attachments?: { data?: Array<{ target?: { id?: string } }> };
}

interface FacebookReel {
    id: string;
    description?: string;
    created_time?: string;
    permalink_url?: string;
    picture?: string;
}

interface FacebookStory {
    post_id?: string;
    status?: string;
    creation_time?: string;
    media_type?: string;
    url?: string;
}

interface InstagramMedia {
    id: string;
    caption?: string;
    media_type?: string;
    media_product_type?: string;
    media_url?: string;
    thumbnail_url?: string;
    permalink?: string;
    timestamp?: string;
}

interface Found {
    platform: Platform;
    kind: ImportedKind;
    externalId: string;
    videoId: string;
    caption: string;
    mediaUrl: string;
    permalink: string;
    publishedAt: Date;
}

export interface ImportResult {
    pages: number;
    found: number;
    errors: string[];
}

/** Reads a Graph list, following the "after" cursor for a few pages. */
async function listAll<T>(
    path: string,
    accessToken: string,
    params: Record<string, string>
): Promise<T[]> {
    const items: T[] = [];
    let after = '';
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const data = await graphRequest<GraphList<T>>(path, {
            accessToken,
            params: { ...params, limit: String(PAGE_SIZE), ...(after ? { after } : {}) },
        });
        items.push(...(data.data ?? []));
        after = data.paging?.cursors?.after ?? '';
        if (!data.paging?.next || !after) break;
    }
    return items;
}

function date(value: string | undefined): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Every id Meta-Bru itself published for a Page: posts, Stories, and reel videos. */
async function ownIds(connectionId: string): Promise<Set<string>> {
    const posts = await Post.find({ connectionId } as QueryFilter<IPost>)
        .select('targets.externalId targets.creationId storyTargets.externalId')
        .lean<Array<Pick<IPost, 'targets' | 'storyTargets'>>>();
    const ids = new Set<string>();
    for (const post of posts) {
        for (const target of [...(post.targets ?? []), ...(post.storyTargets ?? [])]) {
            if (target.externalId) ids.add(target.externalId);
            if (target.creationId) ids.add(target.creationId);
        }
    }
    return ids;
}

async function facebookContent(
    connection: ISocialConnection,
    token: string,
    since: number,
    own: Set<string>
): Promise<Found[]> {
    const found: Found[] = [];
    const reels = await listAll<FacebookReel>(`${connection.pageId}/video_reels`, token, {
        fields: 'id,description,created_time,permalink_url,picture',
        since: String(since),
    });
    const reelIds = new Set(reels.map((reel) => reel.id));
    for (const reel of reels) {
        const publishedAt = date(reel.created_time);
        if (!publishedAt || own.has(reel.id)) continue;
        found.push({
            platform: 'facebook',
            kind: 'reel',
            externalId: reel.id,
            videoId: reel.id,
            caption: reel.description ?? '',
            mediaUrl: reel.picture ?? '',
            permalink: reel.permalink_url ? `https://www.facebook.com${reel.permalink_url}` : '',
            publishedAt,
        });
    }

    const posts = await listAll<FacebookPost>(`${connection.pageId}/published_posts`, token, {
        fields: 'id,message,created_time,status_type,permalink_url,full_picture,attachments{target{id}}',
        since: String(since),
    });
    for (const post of posts) {
        const publishedAt = date(post.created_time);
        if (!publishedAt || own.has(post.id)) continue;
        // A reel also shows up as a post; its attachment points at the video.
        const targets = (post.attachments?.data ?? []).map((item) => item.target?.id ?? '').filter(Boolean);
        if (targets.some((id) => own.has(id) || reelIds.has(id))) continue;
        found.push({
            platform: 'facebook',
            kind: 'post',
            externalId: post.id,
            videoId: '',
            caption: post.message ?? '',
            mediaUrl: post.full_picture ?? '',
            permalink: post.permalink_url ?? '',
            publishedAt,
        });
    }

    const stories = await listAll<FacebookStory>(`${connection.pageId}/stories`, token, {
        fields: 'post_id,status,creation_time,media_type,url',
    });
    for (const story of stories) {
        const publishedAt = date(story.creation_time ? new Date(Number(story.creation_time) * 1000).toISOString() : undefined);
        if (!story.post_id || !publishedAt || own.has(story.post_id)) continue;
        if (story.status && story.status.toUpperCase() !== 'PUBLISHED') continue;
        found.push({
            platform: 'facebook',
            kind: 'story',
            externalId: story.post_id,
            videoId: '',
            caption: '',
            mediaUrl: '',
            permalink: story.url ?? '',
            publishedAt,
        });
    }
    return found;
}

async function instagramContent(
    connection: ISocialConnection,
    token: string,
    since: number,
    own: Set<string>
): Promise<Found[]> {
    const accountId = connection.instagram?.id;
    if (!accountId) return [];
    const found: Found[] = [];
    const fields = 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp';

    const media = await listAll<InstagramMedia>(`${accountId}/media`, token, { fields, since: String(since) });
    for (const item of media) {
        const publishedAt = date(item.timestamp);
        if (!publishedAt || own.has(item.id)) continue;
        found.push({
            platform: 'instagram',
            kind: item.media_product_type === 'REELS' ? 'reel' : 'post',
            externalId: item.id,
            videoId: '',
            caption: item.caption ?? '',
            mediaUrl: item.media_type === 'VIDEO' ? (item.thumbnail_url ?? '') : (item.media_url ?? item.thumbnail_url ?? ''),
            permalink: item.permalink ?? '',
            publishedAt,
        });
    }

    // Instagram lists only Stories that are live right now.
    const stories = await listAll<InstagramMedia>(`${accountId}/stories`, token, { fields });
    for (const item of stories) {
        const publishedAt = date(item.timestamp);
        if (!publishedAt || own.has(item.id)) continue;
        found.push({
            platform: 'instagram',
            kind: 'story',
            externalId: item.id,
            videoId: '',
            caption: item.caption ?? '',
            mediaUrl: item.media_type === 'VIDEO' ? (item.thumbnail_url ?? '') : (item.media_url ?? ''),
            permalink: item.permalink ?? '',
            publishedAt,
        });
    }
    return found;
}

async function save(userId: string, connectionId: string, items: Found[], now: Date): Promise<void> {
    for (const item of items) {
        await ImportedPost.updateOne(
            { userId, platform: item.platform, externalId: item.externalId } as QueryFilter<IImportedPost>,
            {
                $set: {
                    connectionId,
                    kind: item.kind,
                    videoId: item.videoId,
                    caption: item.caption.slice(0, 2200),
                    mediaUrl: item.mediaUrl,
                    permalink: item.permalink,
                    publishedAt: item.publishedAt,
                    lastSeenAt: now,
                },
            },
            { upsert: true }
        );
    }
}

/**
 * Reads posts, reels, and Stories that were published on the user's Pages and
 * Instagram accounts outside Meta-Bru, so Analytics covers everything. Each
 * Page is read at most once an hour unless `force` is set. Failures are
 * reported per Page and never stop the rest.
 */
export async function importNativeContent(
    userId: string,
    options: { connectionId?: string; force?: boolean; now?: Date } = {}
): Promise<ImportResult> {
    const now = options.now ?? new Date();
    const connections = await SocialConnection.find({
        userId,
        tokenStatus: 'active',
        ...(options.connectionId ? { _id: options.connectionId } : {}),
    } as QueryFilter<ISocialConnection>).select('+pageAccessTokenEnc');

    const result: ImportResult = { pages: 0, found: 0, errors: [] };
    for (const connection of connections) {
        const last = connection.nativeImportedAt;
        if (!options.force && last && now.getTime() - last.getTime() < IMPORT_INTERVAL_MS) continue;

        const sinceDate = last
            ? new Date(last.getTime() - OVERLAP_DAYS * 86_400_000)
            : new Date(now.getTime() - FIRST_IMPORT_DAYS * 86_400_000);
        const since = Math.floor(sinceDate.getTime() / 1000);

        let token: string;
        try {
            token = decryptSecret(connection.pageAccessTokenEnc);
        } catch {
            result.errors.push(`${connection.pageName}: reconnect this Page to read its other posts.`);
            continue;
        }

        const own = await ownIds(String(connection._id));
        const found: Found[] = [];
        const errors: string[] = [];
        for (const read of [facebookContent, instagramContent]) {
            try {
                found.push(...(await read(connection, token, since, own)));
            } catch (error) {
                errors.push(
                    `${connection.pageName}: ${sanitizeErrorMessage(error instanceof Error ? error.message : String(error))}`
                );
            }
        }

        await save(userId, String(connection._id), found, now);
        result.pages += 1;
        result.found += found.length;
        result.errors.push(...errors);
        // A Page that failed entirely is retried on the next refresh.
        if (errors.length < 2) {
            await SocialConnection.updateOne({ _id: connection._id, userId }, { $set: { nativeImportedAt: now } });
        }
    }
    return result;
}
