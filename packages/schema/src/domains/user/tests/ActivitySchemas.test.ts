// SPDX-License-Identifier: AGPL-3.0-or-later

import {ActivityResponse} from '@fluxer/schema/src/domains/user/ActivitySchemas';
import {describe, expect, it} from 'vitest';

describe('ActivityResponse', () => {
	it.each([0, 1, 2, 3, 4, 5])('accepts numeric activity type %s', (type) => {
		expect(ActivityResponse.parse({name: 'Activity', type})).toEqual({name: 'Activity', type});
	});

	it('accepts null and omitted optional metadata', () => {
		const input = {
			name: 'Activity',
			type: 0,
			application_id: null,
			details: null,
			state: null,
			timestamps: null,
			assets: null,
		};
		expect(ActivityResponse.parse(input)).toEqual(input);
	});

	it.each(['1', '123456789', '9223372036854775807'])('preserves the application snowflake %s', (application_id) => {
		const input = {name: 'Activity', type: 0, application_id};
		expect(ActivityResponse.parse(input)).toEqual(input);
	});

	it.each(['', '001', '-1', '+1', 'not-a-snowflake', 123, {}])(
		'rejects malformed application ID %s',
		(application_id) => {
			expect(ActivityResponse.safeParse({name: 'Activity', type: 0, application_id}).success).toBe(false);
		},
	);

	it('preserves known metadata and strips unknown fields at every level', () => {
		const input = {
			name: 'Activity',
			type: 2,
			application_id: '123456789',
			details: 'Track',
			state: 'Artist',
			extra: 'discard',
			timestamps: {start: 1791096000000, end: null, extra: 1},
			assets: {large_image: 'artwork', large_text: 'Album', extra: 'discard'},
		};
		expect(ActivityResponse.parse(input)).toEqual({
			name: 'Activity',
			type: 2,
			application_id: '123456789',
			details: 'Track',
			state: 'Artist',
			timestamps: {start: 1791096000000, end: null},
			assets: {large_image: 'artwork', large_text: 'Album'},
		});
	});

	it.each([1791096000, 1791096000000])('preserves the producer timestamp %s without conversion', (start) => {
		const input = {name: 'Activity', type: 0, timestamps: {start}};
		expect(ActivityResponse.parse(input)).toEqual(input);
	});

	it.each([-1, 6, 0.5, 'playing', null, undefined])('rejects invalid type %s', (type) => {
		expect(ActivityResponse.safeParse({name: 'Activity', type}).success).toBe(false);
	});

	it.each([-1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '123'])(
		'rejects unsafe timestamp %s',
		(start) => {
			expect(ActivityResponse.safeParse({name: 'Activity', type: 0, timestamps: {start}}).success).toBe(false);
		},
	);

	it('requires a nonempty string name', () => {
		for (const name of ['', null, 12, undefined]) {
			expect(ActivityResponse.safeParse({name, type: 0}).success).toBe(false);
		}
	});
});
