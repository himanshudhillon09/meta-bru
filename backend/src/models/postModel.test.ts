import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { Post } from './postModel.js';

function validPostInput() {
    return {
        userId: new mongoose.Types.ObjectId(),
        connectionId: new mongoose.Types.ObjectId(),
        caption: 'A caption',
        mediaUrl:
            'https://res.cloudinary.com/demo/image/upload/v1/meta-bru/user-1/image.jpg',
    };
}

test('a post defaults to an image with no Story share', () => {
    const post = new Post(validPostInput());

    assert.equal(post.validateSync(), undefined);
    assert.equal(post.mediaType, 'image');
    assert.equal(post.mediaDuration, 0);
    assert.equal(post.mediaCoverUrl, '');
    assert.equal(post.shareToStory, false);
    assert.equal(post.storyTargets.length, 0);
});

test('a post accepts a reel with Story targets', () => {
    const post = new Post({
        ...validPostInput(),
        mediaType: 'reel',
        mediaDuration: 42.5,
        mediaCoverUrl:
            'https://res.cloudinary.com/demo/video/upload/so_1/reel.jpg',
        shareToStory: true,
        storyTargets: [
            { platform: 'instagram', status: 'failed', error: 'Meta said no' },
        ],
    });

    assert.equal(post.validateSync(), undefined);
    assert.equal(post.mediaType, 'reel');
    assert.equal(post.mediaDuration, 42.5);
    assert.equal(post.storyTargets[0]?.platform, 'instagram');
    assert.equal(post.storyTargets[0]?.status, 'failed');
    assert.equal(post.storyTargets[0]?.externalId, '');
});

test('a post rejects unknown media types and negative durations', () => {
    const post = new Post({
        ...validPostInput(),
        mediaType: 'video',
        mediaDuration: -1,
    });

    const error = post.validateSync();
    assert.ok(error?.errors.mediaType);
    assert.ok(error?.errors.mediaDuration);
});
