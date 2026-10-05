// SPDX-License-Identifier: AGPL-3.0-or-later

import {Endpoints} from '@app/features/app/constants/Endpoints';
import {http} from '@app/features/platform/transport/RestTransport';
import type {CalendarEventResponse} from '@fluxer/schema/src/domains/calendar/CalendarSchemas';

export interface CalendarEventInput {
	name: string;
	description?: string | null;
	starts_at: string;
	ends_at: string;
	recurrence_frequency?: 'daily' | 'weekly' | 'monthly' | null;
	recurrence_interval?: number | null;
	voice_channel_id?: string | null;
	external_location?: string | null;
}

export async function listGuildEvents(guildId: string): Promise<Array<CalendarEventResponse>> {
	const response = await http.get<Array<CalendarEventResponse>>(Endpoints.GUILD_EVENTS(guildId));
	return response.body ?? [];
}

export async function createEvent(guildId: string, data: CalendarEventInput): Promise<CalendarEventResponse> {
	const response = await http.post<CalendarEventResponse>(Endpoints.GUILD_EVENTS(guildId), {body: data});
	return response.body;
}

export async function updateEvent(
	guildId: string,
	eventId: string,
	data: Partial<CalendarEventInput>,
): Promise<CalendarEventResponse> {
	const response = await http.patch<CalendarEventResponse>(Endpoints.GUILD_EVENT(guildId, eventId), {body: data});
	return response.body;
}

export async function deleteEvent(guildId: string, eventId: string): Promise<void> {
	await http.delete(Endpoints.GUILD_EVENT(guildId, eventId));
}

export async function subscribe(guildId: string, eventId: string): Promise<CalendarEventResponse> {
	const response = await http.put<CalendarEventResponse>(Endpoints.GUILD_EVENT_SUBSCRIPTION(guildId, eventId), {body: {}});
	return response.body;
}

export async function unsubscribe(guildId: string, eventId: string): Promise<CalendarEventResponse> {
	const response = await http.delete<CalendarEventResponse>(Endpoints.GUILD_EVENT_SUBSCRIPTION(guildId, eventId));
	return response.body;
}

export async function listMyEvents(): Promise<Array<CalendarEventResponse>> {
	const response = await http.get<Array<CalendarEventResponse>>(Endpoints.USER_CALENDAR_EVENTS);
	return response.body ?? [];
}
