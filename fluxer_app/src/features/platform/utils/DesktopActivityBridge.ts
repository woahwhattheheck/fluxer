// SPDX-License-Identifier: AGPL-3.0-or-later

import LocalPresence from '@app/features/presence/state/LocalPresence';
import {getElectronAPI} from '@app/features/ui/utils/NativeUtils';
import {ActivityResponse} from '@fluxer/schema/src/domains/user/ActivitySchemas';

/**
 * Desktop activity bridge.
 *
 * Subscribes to activity updates pushed by the Electron main process
 * (detectables process matching + Discord-compatible RPC server) and mirrors
 * them into LocalPresence so they propagate through gateway presence.
 */

export function initializeDesktopActivityBridge(): (() => void) | undefined {
	const electronApi = getElectronAPI();
	if (!electronApi?.getCurrentActivities || !electronApi?.onActivitiesUpdated) return undefined;
	let active = true;
	let updateVersion = 0;

	const applyActivities = (activities: unknown): void => {
		if (!active) return;
		if (!Array.isArray(activities)) {
			LocalPresence.setActivities(null);
			return;
		}
		const parsed = activities.flatMap((item) => {
			const result = ActivityResponse.safeParse(item);
			return result.success ? [result.data] : [];
		});
		LocalPresence.setActivities(parsed.length > 0 ? parsed : activities.length === 0 ? [] : null);
	};

	const unsubscribe = electronApi.onActivitiesUpdated((activities) => {
		updateVersion++;
		applyActivities(activities);
	});
	const initialVersion = updateVersion;
	void electronApi
		.getCurrentActivities()
		.then((activities) => {
			if (updateVersion === initialVersion) applyActivities(activities);
		})
		.catch(() => {});
	return () => {
		active = false;
		unsubscribe();
	};
}
