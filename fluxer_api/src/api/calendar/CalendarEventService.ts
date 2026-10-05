// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	createChannelID,
	createEventID,
	type ChannelID,
	type EventID,
	type GuildID,
	type UserID,
} from '@app/api/BrandedTypes';
import {CalendarEventRepository} from '@app/api/calendar/CalendarEventRepository';
import type {IChannelRepository} from '@app/api/channel/IChannelRepository';
import type {CalendarEventRow} from '@app/api/database/types/CalendarTypes';
import type {IGatewayService} from '@app/api/infrastructure/IGatewayService';
import type {ISnowflakeService} from '@app/api/infrastructure/ISnowflakeService';
import {ChannelTypes, Permissions} from '@fluxer/constants/src/ChannelConstants';
import {ValidationErrorCodes} from '@fluxer/constants/src/ValidationErrorCodes';
import {UnknownChannelError} from '@fluxer/errors/src/domains/channel/UnknownChannelError';
import {InputValidationError} from '@fluxer/errors/src/domains/core/InputValidationError';
import {MissingPermissionsError} from '@fluxer/errors/src/domains/core/MissingPermissionsError';
import type {
	CalendarEventCreateRequest,
	CalendarEventResponse,
	CalendarEventUpdateRequest,
} from '@fluxer/schema/src/domains/calendar/CalendarSchemas';

type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly';

export class CalendarEventService {
	constructor(
		private readonly repository: CalendarEventRepository,
		private readonly channelRepository: IChannelRepository,
		private readonly gatewayService: IGatewayService,
		private readonly snowflakeService: ISnowflakeService,
	) {}

	private async getCalendarChannel(guildId: GuildID) {
		const channels = await this.channelRepository.listGuildChannels(guildId);
		const calendar = channels.find((channel) => channel.type === ChannelTypes.GUILD_CALENDAR);
		if (!calendar) throw new UnknownChannelError();
		return calendar;
	}

	private async requirePermission(params: {
		guildId: GuildID;
		userId: UserID;
		permission: bigint;
		channelId?: ChannelID;
	}): Promise<void> {
		const allowed = await this.gatewayService.checkPermission({
			guildId: params.guildId,
			userId: params.userId,
			channelId: params.channelId,
			permission: params.permission,
		});
		if (!allowed) throw new MissingPermissionsError();
	}

	private async requireCalendarAccess(guildId: GuildID, userId: UserID) {
		const calendar = await this.getCalendarChannel(guildId);
		await this.requirePermission({
			guildId,
			userId,
			channelId: calendar.id,
			permission: Permissions.VIEW_CHANNEL,
		});
		return calendar;
	}

	private async validateVoiceChannel(guildId: GuildID, voiceChannelId: bigint | null | undefined): Promise<void> {
		if (voiceChannelId == null) return;
		const channel = await this.channelRepository.findUnique(createChannelID(voiceChannelId));
		if (!channel || channel.guildId !== guildId) {
			throw InputValidationError.fromCode('voice_channel_id', ValidationErrorCodes.CHANNEL_DOES_NOT_EXIST);
		}
		if (channel.type !== ChannelTypes.GUILD_VOICE) {
			throw InputValidationError.fromCode('voice_channel_id', ValidationErrorCodes.CHANNEL_MUST_BE_VOICE);
		}
	}

	private async requireExisting(guildId: GuildID, eventId: EventID): Promise<CalendarEventRow> {
		const event = await this.repository.find(guildId, eventId);
		if (!event) {
			throw InputValidationError.fromCode('event_id', ValidationErrorCodes.EVENT_DOES_NOT_EXIST);
		}
		return event;
	}

	private async canManageEvent(guildId: GuildID, userId: UserID, event: CalendarEventRow): Promise<void> {
		if (event.creator_id === userId) {
			await this.requirePermission({guildId, userId, permission: Permissions.CREATE_EVENTS});
			return;
		}
		await this.requirePermission({guildId, userId, permission: Permissions.MANAGE_EVENTS});
	}

	private async mapResponse(row: CalendarEventRow, userId: UserID): Promise<CalendarEventResponse> {
		const [subscribed, subscriptions] = await Promise.all([
			this.repository.isSubscribed(row.event_id, userId),
			this.repository.listSubscriptions(row.event_id),
		]);
		return {
			id: row.event_id.toString(),
			guild_id: row.guild_id.toString(),
			calendar_channel_id: row.calendar_channel_id.toString(),
			creator_id: row.creator_id.toString(),
			name: row.name,
			description: row.description,
			starts_at: row.starts_at.toISOString(),
			ends_at: row.ends_at.toISOString(),
			recurrence_frequency: row.recurrence_frequency as RecurrenceFrequency | null,
			recurrence_interval: row.recurrence_interval,
			voice_channel_id: row.voice_channel_id?.toString() ?? null,
			external_location: row.external_location,
			created_at: row.created_at.toISOString(),
			updated_at: row.updated_at.toISOString(),
			subscribed,
			subscription_count: subscriptions.length,
		};
	}

	async listGuildEvents(params: {guildId: GuildID; userId: UserID}): Promise<Array<CalendarEventResponse>> {
		await this.requireCalendarAccess(params.guildId, params.userId);
		const events = await this.repository.listByGuild(params.guildId);
		events.sort((a, b) => a.starts_at.getTime() - b.starts_at.getTime());
		return await Promise.all(events.map((event) => this.mapResponse(event, params.userId)));
	}

	async getEvent(params: {guildId: GuildID; eventId: EventID; userId: UserID}): Promise<CalendarEventResponse> {
		await this.requireCalendarAccess(params.guildId, params.userId);
		return await this.mapResponse(await this.requireExisting(params.guildId, params.eventId), params.userId);
	}

	async createEvent(params: {
		guildId: GuildID;
		userId: UserID;
		data: CalendarEventCreateRequest;
	}): Promise<CalendarEventResponse> {
		const calendar = await this.requireCalendarAccess(params.guildId, params.userId);
		await this.requirePermission({
			guildId: params.guildId,
			userId: params.userId,
			permission: Permissions.CREATE_EVENTS,
		});
		await this.validateVoiceChannel(params.guildId, params.data.voice_channel_id);
		const now = new Date();
		const row: CalendarEventRow = {
			guild_id: params.guildId,
			event_id: createEventID(await this.snowflakeService.generate()),
			calendar_channel_id: calendar.id,
			creator_id: params.userId,
			name: params.data.name,
			description: params.data.description ?? null,
			starts_at: new Date(params.data.starts_at),
			ends_at: new Date(params.data.ends_at),
			recurrence_frequency: params.data.recurrence_frequency ?? null,
			recurrence_interval:
				params.data.recurrence_frequency == null ? null : (params.data.recurrence_interval ?? 1),
			voice_channel_id:
				params.data.voice_channel_id == null ? null : createChannelID(params.data.voice_channel_id),
			external_location: params.data.external_location ?? null,
			created_at: now,
			updated_at: now,
			version: 1,
		};
		await this.repository.upsert(row);
		await this.repository.subscribe({
			eventId: row.event_id,
			userId: params.userId,
			guildId: params.guildId,
			subscribedAt: now,
		});
		return await this.mapResponse(row, params.userId);
	}

	async updateEvent(params: {
		guildId: GuildID;
		eventId: EventID;
		userId: UserID;
		data: CalendarEventUpdateRequest;
	}): Promise<CalendarEventResponse> {
		await this.requireCalendarAccess(params.guildId, params.userId);
		const existing = await this.requireExisting(params.guildId, params.eventId);
		await this.canManageEvent(params.guildId, params.userId, existing);
		await this.validateVoiceChannel(params.guildId, params.data.voice_channel_id);
		const nextStartsAt = params.data.starts_at ? new Date(params.data.starts_at) : existing.starts_at;
		const nextEndsAt = params.data.ends_at ? new Date(params.data.ends_at) : existing.ends_at;
		if (nextEndsAt.getTime() <= nextStartsAt.getTime()) {
			throw InputValidationError.fromCode('ends_at', ValidationErrorCodes.EVENT_END_MUST_BE_AFTER_START);
		}
		const row: CalendarEventRow = {
			...existing,
			name: params.data.name ?? existing.name,
			description:
				params.data.description === undefined ? existing.description : (params.data.description ?? null),
			starts_at: nextStartsAt,
			ends_at: nextEndsAt,
			recurrence_frequency:
				params.data.recurrence_frequency === undefined
					? existing.recurrence_frequency
					: params.data.recurrence_frequency,
			recurrence_interval:
				params.data.recurrence_frequency === null
					? null
					: params.data.recurrence_interval === undefined
						? existing.recurrence_interval
						: params.data.recurrence_interval,
			voice_channel_id:
				params.data.voice_channel_id === undefined
					? existing.voice_channel_id
					: params.data.voice_channel_id === null
						? null
						: createChannelID(params.data.voice_channel_id),
			external_location:
				params.data.external_location === undefined
					? existing.external_location
					: (params.data.external_location ?? null),
			updated_at: new Date(),
			version: existing.version + 1,
		};
		await this.repository.upsert(row);
		return await this.mapResponse(row, params.userId);
	}

	async deleteEvent(params: {guildId: GuildID; eventId: EventID; userId: UserID}): Promise<void> {
		await this.requireCalendarAccess(params.guildId, params.userId);
		const existing = await this.requireExisting(params.guildId, params.eventId);
		await this.canManageEvent(params.guildId, params.userId, existing);
		await this.repository.delete(params.guildId, params.eventId);
	}

	async subscribe(params: {guildId: GuildID; eventId: EventID; userId: UserID}): Promise<CalendarEventResponse> {
		await this.requireCalendarAccess(params.guildId, params.userId);
		const event = await this.requireExisting(params.guildId, params.eventId);
		await this.repository.subscribe({
			eventId: params.eventId,
			userId: params.userId,
			guildId: params.guildId,
			subscribedAt: new Date(),
		});
		return await this.mapResponse(event, params.userId);
	}

	async unsubscribe(params: {guildId: GuildID; eventId: EventID; userId: UserID}): Promise<CalendarEventResponse> {
		await this.requireCalendarAccess(params.guildId, params.userId);
		const event = await this.requireExisting(params.guildId, params.eventId);
		await this.repository.unsubscribe(params.eventId, params.userId);
		return await this.mapResponse(event, params.userId);
	}

	async listMyEvents(userId: UserID): Promise<Array<CalendarEventResponse>> {
		const refs = await this.repository.listSubscriptionsByUser(userId);
		const events: Array<CalendarEventResponse> = [];
		for (const ref of refs) {
			const event = await this.repository.find(ref.guild_id, ref.event_id);
			if (!event) continue;
			try {
				await this.requireCalendarAccess(ref.guild_id, userId);
			} catch (error) {
				if (error instanceof MissingPermissionsError || error instanceof UnknownChannelError) continue;
				throw error;
			}
			events.push(await this.mapResponse(event, userId));
		}
		events.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
		return events;
	}

	async exportMyCalendar(userId: UserID): Promise<string> {
		const events = await this.listMyEvents(userId);
		const escape = (value: string): string =>
			value.replaceAll('\\', '\\\\').replaceAll(';', '\\;').replaceAll(',', '\\,').replaceAll('\n', '\\n');
		const formatDate = (value: string): string =>
			new Date(value).toISOString().replaceAll('-', '').replaceAll(':', '').replace('.000', '');
		const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Fluxer//Community Events//EN', 'CALSCALE:GREGORIAN'];
		for (const event of events) {
			lines.push('BEGIN:VEVENT');
			lines.push(`UID:${event.id}@fluxer`);
			lines.push(`DTSTAMP:${formatDate(event.updated_at)}`);
			lines.push(`DTSTART:${formatDate(event.starts_at)}`);
			lines.push(`DTEND:${formatDate(event.ends_at)}`);
			lines.push(`SUMMARY:${escape(event.name)}`);
			if (event.description) lines.push(`DESCRIPTION:${escape(event.description)}`);
			if (event.external_location) lines.push(`LOCATION:${escape(event.external_location)}`);
			if (event.recurrence_frequency) {
				lines.push(
					`RRULE:FREQ=${event.recurrence_frequency.toUpperCase()};INTERVAL=${event.recurrence_interval ?? 1}`,
				);
			}
			lines.push('END:VEVENT');
		}
		lines.push('END:VCALENDAR');
		return `${lines.join('\r\n')}\r\n`;
	}
}
