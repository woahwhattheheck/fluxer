// SPDX-License-Identifier: AGPL-3.0-or-later

import LocalPresence from '@app/features/presence/state/LocalPresence';
import {fromGatewayActivities} from '@app/features/presence/utils/GatewayActivities';
import {getElectronAPI} from '@app/features/ui/utils/NativeUtils';
import {StatusTypes} from '@fluxer/constants/src/StatusConstants';

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
		LocalPresence.setActivities(
			Array.isArray(activities) ? fromGatewayActivities(activities, StatusTypes.ONLINE) : null,
		);
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
