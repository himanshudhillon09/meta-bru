# Image Text Overlay — Design

**Date:** 2026-10-29
**Status:** Approved
**Branch:** `feat/image-text-overlay` (stacked on `feat/reels-stories`)

## Goal

Burn a short, bold, meme-style line into post images, like a reel caption:
white words with 1–3 highlighted in yellow, centred near the bottom of the
photo. Gemini writes the line for AI images; the user can edit it, and can add
one to uploads too.

## Scope

In scope:

- Every AI-generated image gets an overlay line by default.
- Uploaded images get one when the user turns it on.
- Gemini writes the line from the topic, caption, or image prompt, in the
  caption's language, with highlight markers.
- The user edits the line in the Composer and sees an exact server-rendered
  preview.
- The text is rendered into the post image when the post is saved, queued, or
  published, so Facebook, Instagram, and Stories all show it.

Out of scope:

- Editing the overlay of a saved draft from Queue.
- Text on reels.
- Scripts other than Latin. Hindi is written in Roman script (Hinglish).

## Text Rules

- Highlighted words are wrapped in `*stars*`: `Real life wali bandi *ko*`.
  An unpaired star is dropped.
- Emojis and variation selectors are removed; the font cannot draw them.
- At most 90 characters after cleaning.
- Only Latin letters, digits, and common punctuation. Other scripts return
  `400 OVERLAY_SCRIPT_UNSUPPORTED` with a note to use Roman script.
- Characters missing from the font are dropped.

## Rendering

- Font: Poppins ExtraBold (`backend/assets/fonts`, SIL OFL 1.1).
- Text is drawn as vector outlines with opentype.js and composited with sharp.
  sharp's own text rendering uses the macOS font system on Macs and ignores a
  bundled font file, so outlines are the only way to render the same image on
  every machine.
- The text sits inside the photo area. For logo-framed images that is the
  rounded photo box, not the logo band.
- Layout: centred, up to 3 lines, at most 86% of the photo width and 34% of
  its height. The font starts at 7.5% of the photo width and shrinks in 7%
  steps to fit, down to 3.5%.
- Colours: `#FFFFFF` and `#FFD60A`, with a soft drop shadow.
- A transparent-to-black fade (78% at the bottom) behind the text, clipped to
  the photo's rounded corners.

## Photo Area

`renderPostImage` returns `textArea` (`left`, `top`, `width`, `height`,
`radius`): the photo rectangle inside the frame, or the whole image without a
logo. Uploads and AI images return it with the media, and the Composer keeps it
with the draft. A missing or out-of-range area falls back to the whole image.

## API

- `POST /media/text-preview` `{ publicId, text, textArea? }` →
  `{ dataUrl }`. Renders the overlay on the user's uploaded image and returns
  a JPEG data URL without uploading anything. Rate limited.
- `POST /ai/overlay-text` `{ topic?, caption?, prompt? }` → `{ text }`.
- `POST /posts` (image posts) accepts `overlayText` and `mediaTextArea`. When
  the text is not empty, the server renders it onto the image, uploads the
  result, and stores that as the post media. The plain image is then deleted
  when no other post uses it.

Images are always fetched from the user's own Cloudinary cloud by public ID;
client-sent URLs are never fetched.

## Composer

- An "Image text" block appears once there is an image: a switch, a text box,
  an "AI write" button, and a hint about `*stars*`.
- "Generate with AI" turns the switch on and asks Gemini for a line.
- The preview panel shows the rendered overlay, refreshed about a second after
  typing stops.
- The switch, text, and photo area are saved in the draft.

## Testing

- Parsing: highlights, unpaired stars, emojis, whitespace, unsupported scripts.
- Layout: long lines fit within width and 3 lines; short lines stay large.
- Rendering: same image size; pixels outside the photo area unchanged; the
  bottom of the area changes.
- `renderPostImage` returns the photo area for plain and framed images.
- AI line clean-up: quotes, hashtags, emojis, length.
- Post creation with and without overlay text, and plain-image clean-up.
