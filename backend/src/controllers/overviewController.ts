import type { Request, Response } from 'express';
import { buildOverview } from '../services/overviewService.js';

/** The Overview page: schedule health, each Page's queue, and what needs attention. */
export async function getOverview(req: Request, res: Response): Promise<void> {
    const overview = await buildOverview({
        id: req.user.id,
        timezone: req.user.timezone,
        aiProvider: req.user.aiProvider,
    });
    res.json({ success: true, overview });
}
