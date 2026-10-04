// SPDX-License-Identifier: AGPL-3.0-or-later

import {isOfflineStatus, type StatusType} from '@fluxer/constants/src/StatusConstants';
import {ActivityResponse} from '@fluxer/schema/src/domains/user/ActivitySchemas';

export const EMPTY_ACTIVITIES: ReadonlyArray<ActivityResponse> = Object.freeze([]);

export function fromGatewayActivities(payload: unknown, status: StatusType): ReadonlyArray<ActivityResponse> {
	if (isOfflineStatus(status) || !Array.isArray(payload)) {
		return EMPTY_ACTIVITIES;
	}
	const activities: Array<ActivityResponse> = [];
	for (const item of payload) {
		const parsed = ActivityResponse.safeParse(item);
		if (parsed.success) {
			activities.push(parsed.data);
		}
	}
	return activities.length > 0 ? activities : EMPTY_ACTIVITIES;
}
