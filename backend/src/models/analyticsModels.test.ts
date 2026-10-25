import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import {
    PostMetricSnapshot,
    emptyAnalyticsMetrics,
    type IAnalyticsMetrics,
} from './postMetricSnapshotModel.js';
import { AnalyticsAiInsight } from './analyticsAiInsightModel.js';

const METRIC_KEYS: Array<keyof IAnalyticsMetrics> = [
    'likes',
    'comments',
    'shares',
    'saves',
    'reach',
    'views',
    'clicks',
    'interactions',
    'engagementRate',
];

function validSnapshotInput() {
    return {
        userId: new mongoose.Types.ObjectId(),
        connectionId: new mongoose.Types.ObjectId(),
        pageId: 'page-1',
        postId: new mongoose.Types.ObjectId(),
        platform: 'facebook' as const,
        publishedAt: new Date('2026-10-01T00:00:00.000Z'),
        capturedAt: new Date('2026-10-02T00:00:00.000Z'),
    };
}

function validInsightInput() {
    return {
        userId: new mongoose.Types.ObjectId(),
        scopeKey: 'user:all',
        rangeKey: '2026-10-01..2026-10-24',
        dataHash: 'hash-1',
        generatedAt: new Date('2026-10-24T00:00:00.000Z'),
        expiresAt: new Date('2026-10-25T00:00:00.000Z'),
    };
}

test('PostMetricSnapshot declares exactly the four spec indexes with no TTL', () => {
    const indexes = PostMetricSnapshot.schema.indexes();

    assert.equal(indexes.length, 4);
    assert.deepEqual(indexes, [
        [{ userId: 1, publishedAt: -1 }, {}],
        [{ userId: 1, connectionId: 1, publishedAt: -1 }, {}],
        [{ postId: 1, platform: 1, capturedAt: -1 }, {}],
        [{ userId: 1, platform: 1, publishedAt: -1 }, {}],
    ]);

    for (const [, options] of indexes) {
        assert.deepEqual(options, {});
        assert.equal('expireAfterSeconds' in options, false);
    }
});

test('AnalyticsAiInsight declares exactly the two spec indexes including the TTL index', () => {
    const indexes = AnalyticsAiInsight.schema.indexes();

    assert.equal(indexes.length, 2);
    assert.deepEqual(indexes, [
        [{ userId: 1, scopeKey: 1, rangeKey: 1, generatedAt: -1 }, {}],
        [{ expiresAt: 1 }, { expireAfterSeconds: 0 }],
    ]);

    const ttlIndex = indexes.find(([fields]) => fields.expiresAt === 1);
    assert.ok(ttlIndex);
    assert.equal(ttlIndex[1].expireAfterSeconds, 0);
});

test('emptyAnalyticsMetrics returns all nine keys as null', () => {
    const metrics = emptyAnalyticsMetrics();

    assert.deepEqual(Object.keys(metrics), METRIC_KEYS);
    for (const key of METRIC_KEYS) {
        assert.equal(metrics[key], null, `${key} should default to null`);
    }
});

test('emptyAnalyticsMetrics returns a fresh object on every call', () => {
    const first = emptyAnalyticsMetrics();
    const second = emptyAnalyticsMetrics();

    assert.notEqual(first, second);
    first.likes = 7;
    assert.equal(second.likes, null);
});

test('a valid PostMetricSnapshot gets null metrics, empty availability, and unavailable status', () => {
    const snapshot = new PostMetricSnapshot(validSnapshotInput());

    assert.equal(snapshot.validateSync(), undefined);
    const metrics = snapshot.metrics as IAnalyticsMetrics & {
        toObject(): IAnalyticsMetrics;
    };
    assert.deepEqual(metrics.toObject(), emptyAnalyticsMetrics());
    assert.deepEqual(snapshot.availableMetrics, []);
    assert.equal(snapshot.status, 'unavailable');
});

test('setting metrics.likes to 0 preserves 0 instead of null', () => {
    const snapshot = new PostMetricSnapshot(validSnapshotInput());

    snapshot.metrics.likes = 0;

    assert.equal(snapshot.metrics.likes, 0);
    assert.equal(snapshot.validateSync(), undefined);
});

test('an explicit null metrics path fails validation', () => {
    const snapshot = new PostMetricSnapshot(validSnapshotInput());
    snapshot.set('metrics', null);

    const errors = snapshot.validateSync()?.errors;
    assert.ok(errors);
    assert.equal(errors.metrics?.name, 'ValidatorError');
});

test('an explicit null status path fails validation', () => {
    const snapshot = new PostMetricSnapshot(validSnapshotInput());
    snapshot.set('status', null);

    const errors = snapshot.validateSync()?.errors;
    assert.ok(errors);
    assert.equal(errors.status?.name, 'ValidatorError');
});

test('an explicit null availableMetrics path fails validation', () => {
    const snapshot = new PostMetricSnapshot(validSnapshotInput());
    snapshot.set('availableMetrics', null);

    const errors = snapshot.validateSync()?.errors;
    assert.ok(errors);
    assert.equal(errors.availableMetrics?.name, 'ValidatorError');
});

test('a valid AnalyticsAiInsight defaults connectionId, tips, and model', () => {
    const insight = new AnalyticsAiInsight(validInsightInput());

    assert.equal(insight.validateSync(), undefined);
    assert.equal(insight.connectionId, null);
    assert.deepEqual(insight.tips, []);
    assert.equal(insight.model, '');
    assert.equal(typeof insight.model, 'string');
});

test('an explicit null tips path fails validation', () => {
    const insight = new AnalyticsAiInsight(validInsightInput());
    insight.set('tips', null);

    const errors = insight.validateSync()?.errors;
    assert.ok(errors);
    assert.equal(errors.tips?.name, 'ValidatorError');
});
