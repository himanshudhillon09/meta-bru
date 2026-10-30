import type { QueryFilter } from 'mongoose';
import {
    SocialConnection,
    type IPageBrandProfile,
    type ISocialConnection,
} from '../models/socialConnectionModel.js';
import { User } from '../models/userModel.js';
import { logoThumbDataUrl } from './brandLogoService.js';

const EMPTY_PROFILE: IPageBrandProfile = { niche: '', tone: '', audience: '', keywords: '' };

function hasContent(profile: Partial<IPageBrandProfile> | null | undefined): boolean {
    return Boolean(profile?.niche || profile?.audience || profile?.keywords);
}

/**
 * The brand voice for one of the user's Pages, for AI captions, image text,
 * and analysis. Without a Page (for example "All Pages" in Analytics) there is
 * no single voice, so it is empty.
 */
export async function getPageBrandProfile(
    userId: string,
    connectionId?: string | null
): Promise<IPageBrandProfile> {
    if (!connectionId || !/^[a-f\d]{24}$/i.test(connectionId)) return { ...EMPTY_PROFILE };
    const page = await SocialConnection.findOne({ _id: connectionId, userId } as QueryFilter<ISocialConnection>)
        .select('brandProfile')
        .lean<{ brandProfile?: Partial<IPageBrandProfile> }>();
    return { ...EMPTY_PROFILE, ...(page?.brandProfile ?? {}) };
}

/**
 * Branding used to belong to the account. The first time the user's Pages
 * are listed after that changed, the old logo and brand profile move to the
 * Page connected first, unless it already has its own. Other Pages start
 * empty, since each Page is its own brand.
 */
export async function moveLegacyBranding(userId: string): Promise<void> {
    const user = await User.findById(userId).select('+brandLogo.data brandProfile brandMovedAt');
    if (!user || user.brandMovedAt) return;

    const legacyLogo = user.brandLogo?.data?.length && user.brandLogo.updatedAt ? user.brandLogo : null;
    const legacyProfile = hasContent(user.brandProfile) ? user.brandProfile : null;

    if (legacyLogo || legacyProfile) {
        const first = await SocialConnection.findOne({ userId } as QueryFilter<ISocialConnection>)
            .sort({ createdAt: 1 })
            .select('brandProfile brandLogo.updatedAt');
        // Wait for a Page to move the branding to.
        if (!first) return;

        const update: Record<string, unknown> = {};
        if (legacyLogo?.data && !first.brandLogo?.updatedAt) {
            const data = Buffer.from(legacyLogo.data);
            update.brandLogo = {
                data,
                width: legacyLogo.width ?? 0,
                height: legacyLogo.height ?? 0,
                bytes: legacyLogo.bytes ?? data.length,
                updatedAt: legacyLogo.updatedAt,
                thumb: await logoThumbDataUrl(data),
            };
        }
        if (legacyProfile && !hasContent(first.brandProfile)) {
            update.brandProfile = {
                niche: legacyProfile.niche ?? '',
                tone: legacyProfile.tone ?? '',
                audience: legacyProfile.audience ?? '',
                keywords: legacyProfile.keywords ?? '',
            };
        }
        if (Object.keys(update).length > 0) {
            await SocialConnection.updateOne({ _id: first._id, userId }, { $set: update });
        }
    }

    await User.updateOne(
        { _id: userId },
        { $set: { brandMovedAt: new Date() }, $unset: { brandLogo: 1 } }
    );
}
