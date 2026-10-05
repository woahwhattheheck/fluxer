// SPDX-License-Identifier: AGPL-3.0-or-later

import type {ChannelID, EventID, GuildID, UserID} from '@app/api/BrandedTypes';

type Nullish<T> = T | null;

export interface CalendarEventRow {
	guild_id: GuildID;
	event_id: EventID;
	calendar_channel_id: ChannelID;
	creator_id: UserID;
	name: string;
	description: Nullish<string>;
	starts_at: Date;
	ends_at: Date;
	recurrence_frequency: Nullish<string>;
	recurrence_interval: Nullish<number>;
	voice_channel_id: Nullish<ChannelID>;
	external_location: Nullish<string>;
	created_at: Date;
	updated_at: Date;
	version: number;
}

export const CALENDAR_EVENT_COLUMNS = [
	'guild_id',
	'event_id',
	'calendar_channel_id',
	'creator_id',
	'name',
	'description',
	'starts_at',
	'ends_at',
	'recurrence_frequency',
	'recurrence_interval',
	'voice_channel_id',
	'external_location',
	'created_at',
	'updated_at',
	'version',
] as const satisfies ReadonlyArray<keyof CalendarEventRow>;

export interface CalendarEventSubscriptionRow {
	event_id: EventID;
	user_id: UserID;
	guild_id: GuildID;
	subscribed_at: Date;
}

export const CALENDAR_EVENT_SUBSCRIPTION_COLUMNS = [
	'event_id',
	'user_id',
	'guild_id',
	'subscribed_at',
] as const satisfies ReadonlyArray<keyof CalendarEventSubscriptionRow>;

export interface CalendarEventSubscriptionByUserRow {
	user_id: UserID;
	event_id: EventID;
	guild_id: GuildID;
	subscribed_at: Date;
}

export const CALENDAR_EVENT_SUBSCRIPTION_BY_USER_COLUMNS = [
	'user_id',
	'event_id',
	'guild_id',
	'subscribed_at',
] as const satisfies ReadonlyArray<keyof CalendarEventSubscriptionByUserRow>;
