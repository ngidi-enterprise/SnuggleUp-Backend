import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeClientOccurredAt,
  normalizeEventSequence,
} from '../src/services/analyticsEventTiming.js';

test('valid browser event timestamps are normalized to explicit UTC', () => {
  const now = Date.parse('2026-08-06T10:00:00.000Z');
  assert.equal(
    normalizeClientOccurredAt('2026-08-06T11:00:00+02:00', now),
    '2026-08-06T09:00:00.000Z'
  );
});

test('invalid or implausibly distant browser timestamps are rejected', () => {
  const now = Date.parse('2026-08-06T10:00:00.000Z');
  assert.equal(normalizeClientOccurredAt('not-a-date', now), null);
  assert.equal(normalizeClientOccurredAt('2026-08-01T10:00:00.000Z', now), null);
});

test('event sequence accepts only positive safe integers', () => {
  assert.equal(normalizeEventSequence('7'), 7);
  assert.equal(normalizeEventSequence(0), null);
  assert.equal(normalizeEventSequence('invalid'), null);
});
