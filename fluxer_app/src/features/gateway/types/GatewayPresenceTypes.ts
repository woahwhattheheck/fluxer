// SPDX-License-Identifier: AGPL-3.0-or-later

import type {GatewayCustomStatusPayload} from '@app/features/user/state/CustomStatus';
import type {ActivityResponse} from '@fluxer/schema/src/domains/user/ActivitySchemas';
import type {UserPartial} from '@fluxer/schema/src/domains/user/UserResponseSchemas';

/** Activity attached to a presence update (game / music / software). */
export type GatewayUserActivity = ActivityResponse & {
	readonly icon?: string | null;
};

export interface PresenceRecord {
	readonly guild_id?: string | null;
	readonly user: UserPartial;
	readonly status?: string | null;
	readonly afk?: boolean;
	readonly mobile?: boolean;
	readonly custom_status?: GatewayCustomStatusPayload | null;
	readonly activities?: Array<GatewayUserActivity> | null;
}

export type Presence = PresenceRecord;
