// SPDX-License-Identifier: AGPL-3.0-or-later

import LocalPresence from '@app/features/presence/state/LocalPresence';
import {getElectronAPI} from '@app/features/ui/utils/NativeUtils';

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

	const applyActivities = (activities: unknown): void => {
		LocalPresence.setActivities(Array.isArray(activities) ? (activities as never[]) : null);
	};

	void electronApi.getCurrentActivities().then(applyActivities).catch(() => {});
	const unsubscribe = electronApi.onActivitiesUpdated(applyActivities);
	return unsubscribe;
}
