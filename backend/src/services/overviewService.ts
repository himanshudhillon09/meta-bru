import { DateTime } from 'luxon';
import mongoose, { type QueryFilter } from 'mongoose';
import { env } from '../config/env.js';
import { ImportedPost, type IImportedPost } from '../models/importedPostModel.js';
import { Post, type IPost, type IPostTarget, type MediaType, type Platform } from '../models/postModel.js';
import { SocialConnection, type ISocialConnection } from '../models/socialConnectionModel.js';
import { STALE_LOCK_MS } from './connectionLifecycleService.js';
import { getCredentialStatus } from './credentialService.js';
import { schedulerStatus } from './schedulerService.js';
import { upcomingSlots } from './scheduleService.js';

/** Days in the publishing chart: this week and the one before. */
const CHART_DAYS = 14;
/** A scheduler that has not checked for this long is not running. */
const STALE_TICK_MS = 3 * 60_000;
/** A server this new was most likely asleep until a request woke it. */
const RECENT_START_MS = 15 * 60_000;
/** The Up next list covers this far ahead. */
const UPCOMING_WINDOW_MS = 48 * 60 * 60_000;
const UPCOMING_LIMIT = 10;
/** Slots are worked out for at most this many queued posts per Page. */
const MAX_SLOTS = 60;

export type PageState = 'active' | 'paused' | 'reconnect' | 'disconnected';
export type SchedulerState = 'running' | 'off' | 'stalled';
export type AttentionLevel = 'critical' | 'warning' | 'info';

export interface AttentionItem {
    id: string;
    level: AttentionLevel;
    title: string;
    detail: string;
    href: string;
    action: string;
    connectionId?: string;
}

export interface PostBrief {
    postId: string;
    caption: string;
    thumb: string;
    mediaType: MediaType;
    platforms: Platform[];
    story: boolean;
}

interface Delivery {
    platform: Platform;
    status: IPostTarget['status'];
}

export interface OverviewPage {
    connectionId: string;
    pageName: string;
    logoThumb: string;
    instagram: { username: string; profilePictureUrl: string } | null;
    state: PageState;
    dailyTimes: string[];
    timezone: string;
    queued: number;
    /** Queued posts on this Page that skip Instagram although it is linked. */
    queuedWithoutInstagram: number;
    /** How many days the queue lasts at this Page's posting times. */
    runwayDays: number;
    /** The slot that publishes the last queued post. */
    queueEndsAt: string | null;
    nextSlotAt: string | null;
    nextPost: PostBrief | null;
    lastPublished: (PostBrief & { at: string; targets: Delivery[]; storyTargets: Delivery[] }) | null;
    week: { published: number; failed: number; stories: number };
    lastError: string;
    lastRunAt: string | null;
}

export interface UpcomingSlot {
    at: string;
    connectionId: string;
    pageName: string;
    timezone: string;
    logoThumb: string;
    /** Null when nothing is queued for this slot, so it passes without a post. */
    post: PostBrief | null;
}

export interface OverviewDay {
    /** yyyy-MM-dd in the user's timezone. */
    date: string;
    facebook: number;
    instagram: number;
    stories: number;
    /** Posts that failed outright or reached only some platforms. */
    failed: number;
}

interface WeekTotals {
    /** Posts that went out, each counted once. */
    published: number;
    facebook: number;
    instagram: number;
    stories: number;
    failed: number;
}

export interface OverviewReport {
    generatedAt: string;
    timezone: string;
    scheduler: ReturnType<typeof schedulerStatus> & { state: SchedulerState; justStarted: boolean };
    setup: {
        metaApp: boolean;
        cloudinary: boolean;
        aiProvider: 'gemini' | 'claude';
        aiKey: boolean;
        geminiKey: boolean;
        pages: number;
        instagramPages: number;
    };
    counts: { queued: number; drafts: number; publishing: number; published: number; partial: number; failed: number };
    week: WeekTotals & { native: { facebook: number; instagram: number } };
    previousWeek: WeekTotals;
    days: OverviewDay[];
    pages: OverviewPage[];
    upcoming: UpcomingSlot[];
    attention: AttentionItem[];
}

type QueuedPost = Pick<
    IPost,
    'connectionId' | 'caption' | 'mediaUrl' | 'mediaType' | 'mediaCoverUrl' | 'platforms' | 'shareToStory' | 'createdAt'
> & { _id: mongoose.Types.ObjectId };

type WindowPost = Pick<
    IPost,
    'connectionId' | 'caption' | 'mediaUrl' | 'mediaType' | 'mediaCoverUrl' | 'platforms' | 'shareToStory' | 'status' | 'publishedAt' | 'updatedAt' | 'targets' | 'storyTargets'
> & { _id: mongoose.Types.ObjectId };

function brief(post: QueuedPost | WindowPost): PostBrief {
    const platforms: Platform[] = [];
    if (post.platforms?.facebook) platforms.push('facebook');
    if (post.platforms?.instagram) platforms.push('instagram');
    return {
        postId: String(post._id),
        caption: (post.caption ?? '').slice(0, 200),
        thumb: post.mediaType === 'reel' ? post.mediaCoverUrl || '' : post.mediaUrl,
        mediaType: post.mediaType,
        platforms,
        story: Boolean(post.shareToStory),
    };
}

function pageState(connection: ISocialConnection): PageState {
    if (connection.tokenStatus === 'disconnected') return 'disconnected';
    if (connection.tokenStatus === 'needs_reauth') return 'reconnect';
    return connection.isActive ? 'active' : 'paused';
}

function plural(count: number, word: string, many = `${word}s`): string {
    return `${count} ${count === 1 ? word : many}`;
}

function slotLabel(date: Date, timezone: string): string {
    const slot = DateTime.fromJSDate(date).setZone(timezone);
    return slot.isValid ? slot.toFormat('ccc d LLL, HH:mm') : date.toISOString();
}

function emptyWeek(): WeekTotals {
    return { published: 0, facebook: 0, instagram: 0, stories: 0, failed: 0 };
}

/**
 * Everything the Overview shows in one read: whether automatic posting is
 * running, each Page's queue and next slot, what went out over the last two
 * weeks, and what needs the user's attention. Counts come from the database,
 * not from a capped post list, so they are exact.
 */
export async function buildOverview(
    user: { id: string; timezone?: string; aiProvider?: 'gemini' | 'claude' },
    now: Date = new Date()
): Promise<OverviewReport> {
    const userId = new mongoose.Types.ObjectId(user.id);
    const timezone = user.timezone || 'Asia/Kolkata';
    const today = DateTime.fromJSDate(now).setZone(timezone).startOf('day');
    const chartStart = today.minus({ days: CHART_DAYS - 1 });
    const weekStart = today.minus({ days: 6 });
    const since = chartStart.toJSDate();

    const [connections, statusCounts, queuedPosts, windowPosts, lastPublished, credentials, nativeWeek, stuck] =
        await Promise.all([
            SocialConnection.find({ userId } as QueryFilter<ISocialConnection>)
                .select(
                    'pageName tokenStatus instagram dailyTimes timezone isActive nextRunAt lastRunAt lastError grantedScopes brandLogo.thumb createdAt'
                )
                .sort({ createdAt: -1 })
                .lean<ISocialConnection[]>(),
            Post.aggregate<{ _id: IPost['status']; count: number }>([
                { $match: { userId } },
                { $group: { _id: '$status', count: { $sum: 1 } } },
            ]),
            Post.find({ userId, status: 'queued' } as QueryFilter<IPost>)
                .select('connectionId caption mediaUrl mediaType mediaCoverUrl platforms shareToStory createdAt')
                .sort({ createdAt: 1 })
                .limit(2000)
                .lean<QueuedPost[]>(),
            Post.find({
                userId,
                $or: [
                    { publishedAt: { $gte: since } },
                    { 'targets.publishedAt': { $gte: since } },
                    { 'storyTargets.publishedAt': { $gte: since } },
                    { status: { $in: ['failed', 'partial'] }, updatedAt: { $gte: since } },
                    { 'storyTargets.status': 'failed', updatedAt: { $gte: since } },
                ],
            } as QueryFilter<IPost>)
                .select(
                    'connectionId caption mediaUrl mediaType mediaCoverUrl platforms shareToStory status publishedAt updatedAt targets storyTargets'
                )
                .lean<WindowPost[]>(),
            Post.aggregate<{ _id: mongoose.Types.ObjectId; post: WindowPost }>([
                { $match: { userId, status: { $in: ['published', 'partial'] }, publishedAt: { $ne: null } } },
                { $sort: { publishedAt: -1 } },
                {
                    $group: {
                        _id: '$connectionId',
                        post: {
                            $first: {
                                _id: '$_id',
                                connectionId: '$connectionId',
                                caption: '$caption',
                                mediaUrl: '$mediaUrl',
                                mediaType: '$mediaType',
                                mediaCoverUrl: '$mediaCoverUrl',
                                platforms: '$platforms',
                                shareToStory: '$shareToStory',
                                status: '$status',
                                publishedAt: '$publishedAt',
                                updatedAt: '$updatedAt',
                                targets: '$targets',
                                storyTargets: '$storyTargets',
                            },
                        },
                    },
                },
            ]),
            getCredentialStatus(user.id, ''),
            ImportedPost.aggregate<{ _id: Platform; count: number }>([
                {
                    $match: {
                        userId,
                        kind: { $in: ['post', 'reel'] },
                        publishedAt: { $gte: weekStart.toJSDate() },
                    } as QueryFilter<IImportedPost>,
                },
                { $group: { _id: '$platform', count: { $sum: 1 } } },
            ]),
            Post.countDocuments({
                userId,
                status: 'publishing',
                updatedAt: { $lt: new Date(now.getTime() - STALE_LOCK_MS) },
            } as QueryFilter<IPost>),
        ]);

    const counts = { queued: 0, drafts: 0, publishing: 0, published: 0, partial: 0, failed: 0 };
    for (const row of statusCounts) {
        if (row._id === 'draft') counts.drafts = row.count;
        else if (row._id in counts) counts[row._id as keyof typeof counts] = row.count;
    }

    // Two weeks of publishing, bucketed by day in the user's timezone.
    const dayKeys = Array.from({ length: CHART_DAYS }, (_, index) => chartStart.plus({ days: index }).toISODate() ?? '');
    const days = new Map<string, OverviewDay>(
        dayKeys.map((date) => [date, { date, facebook: 0, instagram: 0, stories: 0, failed: 0 }])
    );
    const dayOf = (value: Date | null | undefined) =>
        value ? DateTime.fromJSDate(value).setZone(timezone).toISODate() : null;
    const weekKey = weekStart.toISODate() ?? '';
    const week = emptyWeek();
    const previousWeek = emptyWeek();
    const pageWeek = new Map<string, OverviewPage['week']>();
    const weekFor = (connectionId: string) => {
        const existing = pageWeek.get(connectionId);
        if (existing) return existing;
        const created = { published: 0, failed: 0, stories: 0 };
        pageWeek.set(connectionId, created);
        return created;
    };

    for (const post of windowPosts) {
        const connectionId = String(post.connectionId);
        const firstDay = dayOf(post.publishedAt);
        if (firstDay && days.has(firstDay)) {
            const totals = firstDay >= weekKey ? week : previousWeek;
            totals.published += 1;
            if (firstDay >= weekKey) weekFor(connectionId).published += 1;
        }
        for (const target of post.targets ?? []) {
            const day = target.status === 'published' ? dayOf(target.publishedAt) : null;
            const bucket = day ? days.get(day) : undefined;
            if (!day || !bucket) continue;
            bucket[target.platform] += 1;
            (day >= weekKey ? week : previousWeek)[target.platform] += 1;
        }
        for (const story of post.storyTargets ?? []) {
            const day = story.status === 'published' ? dayOf(story.publishedAt) : null;
            const bucket = day ? days.get(day) : undefined;
            if (!day || !bucket) continue;
            bucket.stories += 1;
            (day >= weekKey ? week : previousWeek).stories += 1;
            if (day >= weekKey) weekFor(connectionId).stories += 1;
        }
        if (post.status === 'failed' || post.status === 'partial') {
            const day = dayOf(post.updatedAt);
            const bucket = day ? days.get(day) : undefined;
            if (day && bucket) {
                bucket.failed += 1;
                (day >= weekKey ? week : previousWeek).failed += 1;
                if (day >= weekKey) weekFor(connectionId).failed += 1;
            }
        }
    }

    const queues = new Map<string, QueuedPost[]>();
    for (const post of queuedPosts) {
        const key = String(post.connectionId);
        queues.set(key, [...(queues.get(key) ?? []), post]);
    }
    const lastByPage = new Map(lastPublished.map((row) => [String(row._id), row.post]));

    const pages: OverviewPage[] = [];
    const upcoming: UpcomingSlot[] = [];
    const horizon = now.getTime() + UPCOMING_WINDOW_MS;

    for (const connection of connections) {
        const connectionId = String(connection._id);
        const queue = queues.get(connectionId) ?? [];
        const state = pageState(connection);
        const scheduled = state === 'active' && connection.nextRunAt;
        const slotsPerDay = Math.max(connection.dailyTimes?.length ?? 1, 1);
        const slots = scheduled
            ? upcomingSlots(
                  connection.dailyTimes,
                  connection.timezone,
                  connection.nextRunAt as Date,
                  Math.min(Math.max(queue.length, UPCOMING_LIMIT), MAX_SLOTS)
              )
            : [];
        const last = lastByPage.get(connectionId);
        const logoThumb = connection.brandLogo?.thumb || '';

        pages.push({
            connectionId,
            pageName: connection.pageName,
            logoThumb,
            instagram: connection.instagram
                ? { username: connection.instagram.username, profilePictureUrl: connection.instagram.profilePictureUrl }
                : null,
            state,
            dailyTimes: connection.dailyTimes ?? [],
            timezone: connection.timezone,
            queued: queue.length,
            queuedWithoutInstagram: connection.instagram
                ? queue.filter((post) => !post.platforms?.instagram).length
                : 0,
            runwayDays: queue.length / slotsPerDay,
            queueEndsAt:
                queue.length > 0 && queue.length <= slots.length
                    ? (slots[queue.length - 1]?.toISOString() ?? null)
                    : null,
            nextSlotAt: slots[0]?.toISOString() ?? null,
            nextPost: scheduled && queue[0] ? brief(queue[0]) : null,
            lastPublished:
                last && last.publishedAt
                    ? {
                          ...brief(last),
                          at: last.publishedAt.toISOString(),
                          targets: (last.targets ?? []).map(({ platform, status }) => ({ platform, status })),
                          storyTargets: (last.storyTargets ?? []).map(({ platform, status }) => ({ platform, status })),
                      }
                    : null,
            week: pageWeek.get(connectionId) ?? { published: 0, failed: 0, stories: 0 },
            lastError: connection.lastError || '',
            lastRunAt: connection.lastRunAt?.toISOString() ?? null,
        });

        // Each slot in the next two days, with the post it publishes. Only
        // the first empty slot per Page is listed; the rest are the same news.
        let listedEmpty = false;
        slots.forEach((slot, index) => {
            if (slot.getTime() > horizon) return;
            const post = queue[index];
            if (!post) {
                if (listedEmpty) return;
                listedEmpty = true;
            }
            upcoming.push({
                at: slot.toISOString(),
                connectionId,
                pageName: connection.pageName,
                timezone: connection.timezone,
                logoThumb,
                post: post ? brief(post) : null,
            });
        });
    }
    upcoming.sort((a, b) => a.at.localeCompare(b.at));

    const status = schedulerStatus();
    const lastTick = status.lastTickAt ? new Date(status.lastTickAt).getTime() : 0;
    const schedulerState: SchedulerState = !status.enabled
        ? 'off'
        : !lastTick || now.getTime() - lastTick > STALE_TICK_MS
          ? 'stalled'
          : 'running';
    const justStarted = Boolean(status.startedAt) && now.getTime() - new Date(status.startedAt as string).getTime() < RECENT_START_MS;

    const aiProvider = user.aiProvider === 'claude' ? 'claude' : 'gemini';
    const setup = {
        metaApp: credentials.meta.configured,
        cloudinary: credentials.cloudinary.configured,
        aiProvider,
        aiKey: aiProvider === 'claude' ? credentials.anthropic.configured : credentials.gemini.configured,
        geminiKey: credentials.gemini.configured,
        pages: connections.length,
        instagramPages: connections.filter((connection) => connection.instagram).length,
    } as const;

    const instagramMissing = await Post.countDocuments({
        userId,
        connectionId: { $in: connections.filter((item) => item.instagram).map((item) => item._id) },
        status: { $in: ['published', 'partial'] },
        targets: {
            $elemMatch: { platform: 'facebook', status: 'published' },
            $not: { $elemMatch: { platform: 'instagram', status: 'published' } },
        },
    } as QueryFilter<IPost>);

    const attention = buildAttention({
        now,
        schedulerState,
        justStarted,
        startedAt: status.startedAt,
        setup,
        pages,
        connections,
        week,
        windowPosts,
        weekStart: weekStart.toJSDate(),
        stuck,
        instagramMissing,
    });

    return {
        generatedAt: now.toISOString(),
        timezone,
        scheduler: { ...status, state: schedulerState, justStarted },
        setup,
        counts,
        week: {
            ...week,
            native: {
                facebook: nativeWeek.find((row) => row._id === 'facebook')?.count ?? 0,
                instagram: nativeWeek.find((row) => row._id === 'instagram')?.count ?? 0,
            },
        },
        previousWeek,
        days: dayKeys.map((date) => days.get(date) as OverviewDay),
        pages,
        upcoming: upcoming.slice(0, UPCOMING_LIMIT),
        attention,
    };
}

function buildAttention(input: {
    now: Date;
    schedulerState: SchedulerState;
    justStarted: boolean;
    startedAt: string | null;
    setup: OverviewReport['setup'];
    pages: OverviewPage[];
    connections: ISocialConnection[];
    week: WeekTotals;
    windowPosts: WindowPost[];
    weekStart: Date;
    stuck: number;
    instagramMissing: number;
}): AttentionItem[] {
    const items: AttentionItem[] = [];
    const { setup, pages } = input;
    const activePages = pages.filter((page) => page.state === 'active');
    const queuedTotal = pages.reduce((sum, page) => sum + page.queued, 0);

    if (input.schedulerState === 'off') {
        items.push({
            id: 'scheduler-off',
            level: 'critical',
            title: 'Automatic posting is turned off on the server',
            detail: `Queued posts only go out when you press Post now. Remove SCHEDULER_ENABLED=false from the backend's environment and redeploy.`,
            href: '/queue',
            action: 'Open queue',
        });
    } else if (input.schedulerState === 'stalled') {
        items.push({
            id: 'scheduler-stalled',
            level: 'critical',
            title: 'The scheduler has stopped checking the queue',
            detail: 'Nothing will publish on schedule until the backend is restarted. Posts go out once it checks again.',
            href: '/queue',
            action: 'Open queue',
        });
    }

    if (!setup.metaApp) {
        items.push({
            id: 'setup-meta',
            level: 'critical',
            title: 'Add your Meta app',
            detail: 'Meta-Bru needs your Meta App ID and secret to connect Pages and publish.',
            href: '/settings#integrations',
            action: 'Open Profile',
        });
    } else if (setup.pages === 0) {
        items.push({
            id: 'setup-pages',
            level: 'critical',
            title: 'Connect a Facebook Page',
            detail: 'Nothing can be scheduled until at least one Page is connected.',
            href: '/connections',
            action: 'Connect a Page',
        });
    }

    for (const page of pages.filter((item) => item.state === 'reconnect')) {
        items.push({
            id: `reconnect-${page.connectionId}`,
            level: 'critical',
            title: `Reconnect ${page.pageName}`,
            detail:
                page.queued > 0
                    ? `Meta stopped accepting this Page's access, so ${plural(page.queued, 'queued post')} ${page.queued === 1 ? 'is' : 'are'} on hold.`
                    : "Meta stopped accepting this Page's access. Nothing can publish to it until you reconnect.",
            href: '/connections',
            action: 'Reconnect',
            connectionId: page.connectionId,
        });
    }

    if (input.stuck > 0) {
        items.push({
            id: 'stuck-publishing',
            level: 'warning',
            title: `${plural(input.stuck, 'post')} stuck publishing`,
            detail: 'Publishing started more than 15 minutes ago and never finished. The scheduler marks them failed on its next check so you can retry.',
            href: '/queue',
            action: 'Open queue',
        });
    }

    const weekFailed = input.windowPosts.filter(
        (post) => post.status === 'failed' && post.updatedAt >= input.weekStart
    ).length;
    const weekPartial = input.windowPosts.filter(
        (post) => post.status === 'partial' && post.updatedAt >= input.weekStart
    ).length;
    const storyFailures = input.windowPosts.filter(
        (post) => post.updatedAt >= input.weekStart && (post.storyTargets ?? []).some((story) => story.status === 'failed')
    ).length;

    if (weekFailed > 0) {
        items.push({
            id: 'failed-posts',
            level: 'warning',
            title: `${plural(weekFailed, 'post')} failed this week`,
            detail: 'They did not reach Facebook or Instagram. Open Activity to see why and retry.',
            href: '/activity?filter=failed',
            action: 'Review',
        });
    }
    if (weekPartial > 0) {
        items.push({
            id: 'partial-posts',
            level: 'warning',
            title: `${plural(weekPartial, 'post')} reached only one platform`,
            detail: 'One of Facebook or Instagram rejected them. Activity shows which one and the reason.',
            href: '/activity?filter=failed',
            action: 'Review',
        });
    }
    if (storyFailures > 0) {
        items.push({
            id: 'story-failures',
            level: 'warning',
            title: `${plural(storyFailures, 'Story share')} failed this week`,
            detail: 'The post went out but its Story did not. You can share it to Story again from Activity.',
            href: '/activity?filter=failed',
            action: 'Review',
        });
    }

    for (const page of activePages) {
        const times = page.dailyTimes.length;
        if (page.queued === 0) {
            items.push({
                id: `empty-${page.connectionId}`,
                level: 'warning',
                title: `${page.pageName} has nothing queued`,
                detail: page.nextSlotAt
                    ? `Its next slot (${slotLabel(new Date(page.nextSlotAt), page.timezone)}) will pass without a post.`
                    : 'Its posting times will pass without a post.',
                href: '/composer',
                action: 'Add a post',
                connectionId: page.connectionId,
            });
        } else if (page.runwayDays < 1 && page.queueEndsAt) {
            items.push({
                id: `low-${page.connectionId}`,
                level: 'warning',
                title: `${page.pageName}'s queue runs out ${slotLabel(new Date(page.queueEndsAt), page.timezone)}`,
                detail: `${plural(page.queued, 'post')} left for ${plural(times, 'posting time')} a day. Add more to keep posting daily.`,
                href: '/composer',
                action: 'Add posts',
                connectionId: page.connectionId,
            });
        }
        if (page.lastError) {
            items.push({
                id: `error-${page.connectionId}`,
                level: 'warning',
                title: `${page.pageName}: last run had a problem`,
                detail: page.lastError,
                href: '/activity',
                action: 'Open Activity',
                connectionId: page.connectionId,
            });
        }
    }

    for (const page of pages.filter((item) => item.state === 'paused' && item.queued > 0)) {
        items.push({
            id: `paused-${page.connectionId}`,
            level: 'warning',
            title: `${page.pageName} is paused with ${plural(page.queued, 'post')} waiting`,
            detail: 'Nothing publishes on schedule while it is paused. Turn the schedule back on, or use Post now.',
            href: '/connections',
            action: 'Open schedule',
            connectionId: page.connectionId,
        });
    }

    if (!setup.cloudinary) {
        items.push({
            id: 'setup-cloudinary',
            level: 'warning',
            title: 'Add Cloudinary to upload media',
            detail: 'New images, reels, and AI images need your Cloudinary account. Queued posts still publish.',
            href: '/settings#integrations',
            action: 'Open Profile',
        });
    }
    if (!setup.aiKey) {
        items.push({
            id: 'setup-ai',
            level: 'warning',
            title: `Add your ${setup.aiProvider === 'claude' ? 'Anthropic' : 'Gemini'} API key`,
            detail: `${setup.aiProvider === 'claude' ? 'Claude' : 'Gemini'} is your AI provider, so AI captions and tips stop working without its key. Posting is not affected.`,
            href: '/settings#ai',
            action: 'Open Profile',
        });
    } else if (setup.aiProvider === 'claude' && !setup.geminiKey) {
        items.push({
            id: 'setup-gemini-images',
            level: 'info',
            title: 'AI images need a Gemini key',
            detail: 'Claude writes your captions and image prompts, but Gemini draws the images. Add a Gemini key to generate images.',
            href: '/settings#ai',
            action: 'Open Profile',
        });
    }

    if (input.instagramMissing > 0) {
        items.push({
            id: 'instagram-missing',
            level: 'info',
            title: `${plural(input.instagramMissing, 'Facebook post')} can now go to Instagram`,
            detail: 'Their Page has Instagram linked now. Publish them there from Activity.',
            href: '/activity?filter=instagram-missing',
            action: 'Review',
        });
    }
    for (const page of pages.filter((item) => item.queuedWithoutInstagram > 0 && item.state !== 'disconnected')) {
        items.push({
            id: `queue-skips-instagram-${page.connectionId}`,
            level: 'info',
            title: `${plural(page.queuedWithoutInstagram, 'queued post')} on ${page.pageName} skip${page.queuedWithoutInstagram === 1 ? 's' : ''} Instagram`,
            detail: `@${page.instagram?.username || 'Instagram'} is linked, but ${page.queuedWithoutInstagram === 1 ? 'this post was' : 'these posts were'} queued for Facebook only. Edit ${page.queuedWithoutInstagram === 1 ? 'it' : 'them'} in the Queue to add Instagram.`,
            href: '/queue',
            action: 'Open queue',
            connectionId: page.connectionId,
        });
    }

    const missingInsights = input.connections.filter(
        (connection) =>
            connection.tokenStatus === 'active' &&
            (connection.grantedScopes?.length ?? 0) > 0 &&
            (!connection.grantedScopes.includes('read_insights') ||
                (connection.instagram && !connection.grantedScopes.includes('instagram_manage_insights')))
    );
    for (const connection of missingInsights) {
        items.push({
            id: `insights-${String(connection._id)}`,
            level: 'info',
            title: `Analytics can't read ${connection.pageName}'s insights`,
            detail: 'Its connection is missing the insights permissions. Reconnect it and allow them.',
            href: '/connections',
            action: 'Reconnect',
            connectionId: String(connection._id),
        });
    }

    if (input.justStarted && input.schedulerState === 'running' && activePages.length > 0 && queuedTotal > 0) {
        items.push({
            id: 'server-woke',
            level: 'info',
            title: 'The server just woke up',
            detail: `It started ${plural(Math.max(1, Math.round((input.now.getTime() - new Date(input.startedAt ?? input.now).getTime()) / 60_000)), 'minute')} ago, so it was probably asleep. Slots slept through by more than ${Math.round(env.scheduler.graceMinutes / 60)} hours are skipped. Ping /api/health every 5 to 10 minutes with an uptime monitor to keep it awake.`,
            href: '/queue',
            action: 'Open queue',
        });
    }

    const order: Record<AttentionLevel, number> = { critical: 0, warning: 1, info: 2 };
    return items.sort((a, b) => order[a.level] - order[b.level]);
}
