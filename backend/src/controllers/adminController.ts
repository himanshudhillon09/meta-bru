import type { Request, Response } from 'express';
import { Post } from '../models/postModel.js';
import { SocialConnection } from '../models/socialConnectionModel.js';
import { User } from '../models/userModel.js';

export async function adminOverview(_req: Request, res: Response): Promise<void> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [users, connections, queued, publishedThisWeek, needsReauth, recentPosts] =
        await Promise.all([
            User.countDocuments({}),
            SocialConnection.countDocuments({}),
            Post.countDocuments({ status: 'queued' }),
            Post.countDocuments({
                status: { $in: ['published', 'partial'] },
                publishedAt: { $gte: sevenDaysAgo },
            }),
            SocialConnection.countDocuments({ tokenStatus: 'needs_reauth' }),
            Post.find({})
                .sort({ createdAt: -1 })
                .limit(10)
                .populate('userId', 'name email')
                .populate('connectionId', 'pageName'),
        ]);

    res.json({
        success: true,
        stats: {
            users,
            connections,
            queued,
            publishedThisWeek,
            needsReauth,
        },
        recentPosts,
    });
}

export async function adminConnections(_req: Request, res: Response): Promise<void> {
    const connections = await SocialConnection.find({})
        .select('-pageAccessTokenEnc')
        .populate('userId', 'name email')
        .sort({ createdAt: -1 })
        .limit(200);

    res.json({ success: true, connections });
}

export async function adminPosts(_req: Request, res: Response): Promise<void> {
    const posts = await Post.find({})
        .sort({ createdAt: -1 })
        .limit(200)
        .populate('userId', 'name email')
        .populate('connectionId', 'pageName instagram');

    res.json({ success: true, posts });
}
