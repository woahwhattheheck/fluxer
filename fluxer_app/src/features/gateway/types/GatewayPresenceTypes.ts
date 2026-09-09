// SPDX-License-Identifier: AGPL-3.0-or-later

import type {GatewayCustomStatusPayload} from '@app/features/user/state/CustomStatus';
import type {UserPartial} from '@fluxer/schema/src/domains/user/UserResponseSchemas';

/** Activity attached to a presence update (game / music / software). */
export interface GatewayUserActivity {
	readonly name: string;
	readonly type: number;
	readonly state?: string | null;
	readonly details?: string | null;
	readonly icon?: string | null;
	readonly assets?: {
		readonly large_image?: string | null;
		readonly large_text?: string | null;
		readonly small_image?: string | null;
		readonly small_text?: string | null;
	} | null;
	readonly timestamps?: {
		readonly start?: number | null;
		readonly end?: number | null;
	} | null;
}

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
