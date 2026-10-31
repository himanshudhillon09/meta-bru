/**
 * Writing rules shared by every AI provider, so Gemini and Claude write
 * captions, image text, and images to the same standard. Each provider adds
 * only its own output format around these.
 */

type Platform = 'facebook' | 'instagram' | 'both';

const ROMAN_HINGLISH = 'For Hindi or Hinglish, write Hinglish in Roman (English) letters, never Devanagari.';

export const LANGUAGE_RULE = `Write in the language of the topic and brand details. ${ROMAN_HINGLISH}`;

export const FACTS_RULE =
    'Never invent prices, dates, offers, statistics, names, places, or claims that are not in the topic, the brand details, or clearly visible in the image.';

/** How a caption grows a Page: what Meta rewards and how to write for it. */
export const CAPTION_RULES = [
    'Meta shows posts to new people when viewers send them to friends, save them, and stop to read. Write for that.',
    '- Hook first. The first line, under 80 characters, is all most people see before "more". Make it stop the scroll: a surprising specific, a bold opinion, a relatable moment, or a clear benefit. Never open with a greeting, the brand name, "Introducing", or "Are you ready".',
    '- Crisp. 25 to 90 words in all. One or two short sentences per line, a blank line between ideas. Cut every word that does not add meaning.',
    '- Specific. Name the real thing: the dish, the product, the place, the number, the feeling. Concrete details beat adjectives.',
    '- Searchable. Work one or two words people would search for (what it is, where, who it is for) naturally into the first two lines; Instagram and Facebook search read captions.',
    '- Give a reason to share or save: something relatable, useful, or funny enough to send a friend, or a tip worth coming back to.',
    '- End with one call to action that matches that reason: "Send this to someone who...", "Save this for...", or a question people can answer in a few words. Never engagement bait: no asking for likes, "comment YES", "tag 3 friends", or "share if you agree"; Meta demotes it.',
    '- Sound like a real person from the brand talking to one follower. Plain words. Never use hype or AI-sounding words such as elevate, unleash, unlock, dive into, game-changer, must-try, look no further, journey, or "in today\'s world". No stacked exclamation marks.',
    '- 0 to 3 emojis, only where they replace a word or mark a line, never two in a row.',
    `- ${LANGUAGE_RULE}`,
    `- ${FACTS_RULE}`,
];

export const HASHTAG_RULE =
    'Hashtags: tags people actually search for and follow about this exact subject. One broad category tag, then niche and community tags, plus a place or brand tag only if the details give one. Every tag must fit the post. Never generic or spam tags such as #love, #instagood, #viral, #trending, #explore, #fyp, #followforfollow, or #like4like.';

/** What works on each platform, for the caption brief. */
export function platformNote(platform: Platform): string {
    if (platform === 'instagram') {
        return 'Instagram: hook, two to four short lines, then the call to action. Sends and saves push the post to people who do not follow the account yet.';
    }
    if (platform === 'facebook') {
        return 'Facebook: conversational, one to three short paragraphs, ending with a question people can answer in a few words. Comments and shares spread it.';
    }
    return 'The same caption goes to Facebook and Instagram: keep it short enough for Instagram and end with a question or a reason to send it, which works on both.';
}

/** The bold line printed across an image. */
export const OVERLAY_RULES = [
    'You write the one short line printed in big bold letters across a social media image, the way viral reels and meme pages do. People give an image half a second, so this line decides whether they stop.',
    '- 3 to 8 words, never more than 10 words or 60 characters.',
    '- Add what the picture cannot say on its own: the thought, the twist, the relatable truth, or the payoff. Never a label, a description of the image, or the brand name.',
    '- Patterns that work: a relatable "when you..." moment, a bold opinion, a small promise ("3 signs you need a break"), or a contrast.',
    `- Use the same language and style as the post. ${ROMAN_HINGLISH}`,
    '- Wrap the 1 to 3 most important words in *asterisks*; they print in the highlight colour. Example: Real life wali bandi *ko* pata chal gaya',
    '- No hashtags, no emojis, no quotation marks, and no full stop at the end.',
];

/** What makes an AI image work in a Facebook and Instagram feed. */
export const IMAGE_RULES = [
    'One clear subject that reads instantly on a phone screen, framed close, with strong contrast and a clean, uncluttered background.',
    'A specific, real-looking moment: setting, time of day, natural light with texture, camera angle, and mood. Vivid but true-to-life colour, never a generic stock scene.',
    "People, food, products, and places look authentic for the brand's audience and place.",
    'The subject sits in the upper and middle part of the frame and the bottom quarter stays simple, because a bold line of white text is printed across the bottom.',
    'No text, letters, captions, logos, watermarks, borders, or frames in the image; Meta-Bru adds the text and the logo frame itself.',
];

/**
 * The prompt Gemini draws from when no Claude art direction was written:
 * the user's description first, then who it is for, then the feed rules.
 */
export function buildImageGenerationPrompt(
    description: string,
    brand: { niche?: string; audience?: string } = {}
): string {
    const lines = [description.trim(), ''];
    if (brand.niche) lines.push(`For a brand in: ${brand.niche}.`);
    if (brand.audience) lines.push(`Its audience: ${brand.audience}.`);
    lines.push(
        'Make this one square image for a Facebook and Instagram feed post. Photorealistic unless the description asks for another style.',
        ...IMAGE_RULES
    );
    return lines.join('\n');
}
