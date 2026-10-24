import test from 'node:test';
import assert from 'node:assert/strict';
import {
    STALE_LOCK_MS,
    canPublishWithStatus,
    isConnectionBusy,
    shouldRecomputeScheduleOnReconnect,
} from './connectionLifecycleService.js';

const NOW = new Date('2026-10-23T10:00:00.000Z');

test('a fresh scheduler lock blocks disconnect', () => {
    assert.equal(
        isConnectionBusy(new Date(NOW.getTime() - 1_000), null, NOW),
        true
    );
});

test('a fresh publishing post blocks disconnect', () => {
    assert.equal(
        isConnectionBusy(null, new Date(NOW.getTime() - 1_000), NOW),
        true
    );
});

test('no lock or publishing post does not block disconnect', () => {
    assert.equal(isConnectionBusy(null, null, NOW), false);
});

test('stale locks and publishing posts do not block disconnect', () => {
    const stale = new Date(NOW.getTime() - STALE_LOCK_MS - 1);
    assert.equal(isConnectionBusy(stale, stale, NOW), false);
});

test('only active connections can publish', () => {
    assert.equal(canPublishWithStatus('active'), true);
    assert.equal(canPublishWithStatus('needs_reauth'), false);
    assert.equal(canPublishWithStatus('disconnected'), false);
});

test('reconnect recomputes an active schedule after a gap', () => {
    assert.equal(
        shouldRecomputeScheduleOnReconnect('disconnected', true),
        true
    );
    assert.equal(
        shouldRecomputeScheduleOnReconnect('needs_reauth', true),
        true
    );
});

test('reconnect preserves an active or paused schedule', () => {
    assert.equal(
        shouldRecomputeScheduleOnReconnect('active', true),
        false
    );
    assert.equal(
        shouldRecomputeScheduleOnReconnect('disconnected', false),
        false
    );
});
