// SPDX-License-Identifier: AGPL-3.0-or-later

import type {ActivityResponse} from '@fluxer/schema/src/domains/user/ActivitySchemas';

/**
 * Pure helpers for rendering presence activities. Kept free of React/store
 * imports so the formatting logic is unit-testable.
 */

const ACTIVITY_TYPE_VERBS = new Map<number, string>([
	[0, 'Playing'],
	[1, 'Streaming'],
	[2, 'Listening to'],
	[3, 'Watching'],
	[5, 'Competing in'],
]);

export function activityVerb(type: number): string {
	return ACTIVITY_TYPE_VERBS.get(type) ?? 'Using';
}

/** Primary line, e.g. `Playing Minecraft`. */
export function formatActivityTitle(activity: ActivityResponse): string {
	return `${activityVerb(activity.type)} ${activity.name}`.trim();
}

/** Secondary line: details over state, both clamped to a sane length. */
export function formatActivitySubtitle(activity: ActivityResponse): string | null {
	const parts = [activity.details, activity.state].filter(
		(part): part is string => typeof part === 'string' && part.length > 0,
	);
	if (parts.length === 0) return null;
	const joined = parts.join(' — ');
	return joined.length > 128 ? `${joined.slice(0, 125)}...` : joined;
}

/** Elapsed humanization for `timestamps.start`. */
export function formatActivityElapsed(activity: ActivityResponse, now: number = Date.now()): string | null {
	const start = activity.timestamps?.start;
	if (typeof start !== 'number' || !Number.isFinite(start) || start <= 0 || start > now) return null;
	const elapsedSeconds = Math.floor((now - start) / 1000);
	const hours = Math.floor(elapsedSeconds / 3600);
	const minutes = Math.floor((elapsedSeconds % 3600) / 60);
	const seconds = elapsedSeconds % 60;
	if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
	return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Clamp arbitrary activity lists before render. */
export function sanitizeActivities(
	activities: ReadonlyArray<ActivityResponse | null | undefined> | null | undefined,
	max = 3,
): Array<ActivityResponse> {
	if (!Array.isArray(activities)) return [];
	return activities
		.filter((activity): activity is ActivityResponse => {
			if (activity == null) return false;
			if (typeof (activity as ActivityResponse).name !== 'string') return false;
			return (activity as ActivityResponse).name.length > 0;
		})
		.slice(0, max);
}
