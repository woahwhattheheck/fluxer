// SPDX-License-Identifier: AGPL-3.0-or-later

import {describe, expect, it} from 'vitest';

import type {GatewayUserActivity} from '@app/features/gateway/types/GatewayPresenceTypes';
import {
	activityVerb,
	formatActivityElapsed,
	formatActivitySubtitle,
	formatActivityTitle,
	sanitizeActivities,
} from '@app/features/presence/utils/ActivityDisplayUtils';

describe('activityVerb', () => {
	it('maps known types to verbs', () => {
		expect(activityVerb(0)).toBe('Playing');
		expect(activityVerb(2)).toBe('Listening to');
		expect(activityVerb(3)).toBe('Watching');
	});

	it('falls back to Using for unknown types', () => {
		expect(activityVerb(99)).toBe('Using');
	});
});

describe('formatActivityTitle', () => {
	it('combines verb and name', () => {
		expect(formatActivityTitle({name: 'Minecraft', type: 0})).toBe('Playing Minecraft');
	});

	it('handles listening activities', () => {
		expect(formatActivityTitle({name: 'Spotify', type: 2})).toBe('Listening to Spotify');
	});
});

describe('formatActivitySubtitle', () => {
	it('prefers details then state', () => {
		expect(formatActivitySubtitle({name: 'X', type: 0, details: 'd', state: 's'})).toBe('d — s');
		expect(formatActivitySubtitle({name: 'X', type: 0, state: 'only state'})).toBe('only state');
	});

	it('returns null when neither is present', () => {
		expect(formatActivitySubtitle({name: 'X', type: 0})).toBeNull();
	});

	it('clamps long subtitles', () => {
		const long = 'a'.repeat(200);
		const result = formatActivitySubtitle({name: 'X', type: 0, details: long});
		expect(result?.length).toBe(128);
		expect(result?.endsWith('...')).toBe(true);
	});
});

describe('formatActivityElapsed', () => {
	it('formats minutes and seconds', () => {
		const now = 1_000_000;
		expect(formatActivityElapsed({name: 'X', type: 0, timestamps: {start: now - 65_000}}, now)).toBe('1:05');
	});

	it('formats hours', () => {
		const now = 10_000_000;
		expect(formatActivityElapsed({name: 'X', type: 0, timestamps: {start: now - 3_725_000}}, now)).toBe(
			'1:02:05',
		);
	});

	it('returns null without a start timestamp', () => {
		expect(formatActivityElapsed({name: 'X', type: 0})).toBeNull();
		expect(formatActivityElapsed({name: 'X', type: 0, timestamps: {start: 0}})).toBeNull();
	});

	it('returns null for future starts', () => {
		const now = 1_000_000;
		expect(formatActivityElapsed({name: 'X', type: 0, timestamps: {start: now + 5_000}}, now)).toBeNull();
	});
});

describe('sanitizeActivities', () => {
	it('drops invalid entries and clamps the count', () => {
		const valid = {name: 'A', type: 0};
		expect(sanitizeActivities([valid, {name: '', type: 0}, undefined, {name: 'B', type: 0}] as Array<GatewayUserActivity | undefined>, 1)).toEqual([
			valid,
		]);
	});

	it('handles null and undefined input', () => {
		expect(sanitizeActivities(null)).toEqual([]);
		expect(sanitizeActivities(undefined)).toEqual([]);
	});
});
