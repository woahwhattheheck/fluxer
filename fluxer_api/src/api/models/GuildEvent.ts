// SPDX-License-Identifier: AGPL-3.0-or-later

import type {ChannelID, EventID, GuildID, UserID} from '@app/api/BrandedTypes';
import type {GuildEventRow} from '@app/api/database/types/GuildTypes';

export type GuildEventRecurrenceUnitValue = 'day' | 'week' | 'month';

export class GuildEvent {
	readonly guildId: GuildID;
	readonly id: EventID;
	readonly creatorId: UserID;
	readonly name: string;
	readonly description: string | null;
	readonly scheduledStartTime: Date;
	readonly scheduledEndTime: Date;
	readonly channelId: ChannelID | null;
	readonly location: string | null;
	readonly recurrenceInterval: number | null;
	readonly recurrenceUnit: GuildEventRecurrenceUnitValue | null;
	readonly passwordHash: string | null;
	readonly version: number;

	constructor(row: GuildEventRow) {
		this.guildId = row.guild_id;
		this.id = row.event_id;
		this.creatorId = row.creator_id;
		this.name = row.name;
		this.description = row.description ?? null;
		this.scheduledStartTime = row.scheduled_start_time;
		this.scheduledEndTime = row.scheduled_end_time;
		this.channelId = row.channel_id ?? null;
		this.location = row.location ?? null;
		this.recurrenceInterval = row.recurrence_interval ?? null;
		this.recurrenceUnit =
			row.recurrence_unit === 'day' || row.recurrence_unit === 'week' || row.recurrence_unit === 'month'
				? row.recurrence_unit
				: null;
		this.passwordHash = row.password_hash ?? null;
		this.version = row.version;
	}

	toRow(): GuildEventRow {
		return {
			guild_id: this.guildId,
			event_id: this.id,
			creator_id: this.creatorId,
			name: this.name,
			description: this.description,
			scheduled_start_time: this.scheduledStartTime,
			scheduled_end_time: this.scheduledEndTime,
			channel_id: this.channelId,
			location: this.location,
			recurrence_interval: this.recurrenceInterval,
			recurrence_unit: this.recurrenceUnit,
			password_hash: this.passwordHash,
			version: this.version,
		};
	}
}
