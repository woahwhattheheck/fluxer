// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	createStringType,
	Int32Type,
	SnowflakeStringType,
	SnowflakeType,
} from '@fluxer/schema/src/primitives/SchemaPrimitives';
import {z} from 'zod';

export const GuildIdEventIdParam = z.object({
	guild_id: SnowflakeType.describe('The ID of the guild'),
	event_id: SnowflakeType.describe('The ID of the event'),
});

export type GuildIdEventIdParam = z.infer<typeof GuildIdEventIdParam>;

const CalendarEventFields = z.object({
	name: createStringType(1, 100).describe('The event name'),
	description: createStringType(0, 4000).nullish().describe('Optional event description'),
	starts_at: z.iso.datetime().describe('Event start time in ISO 8601 format'),
	ends_at: z.iso.datetime().describe('Event end time in ISO 8601 format'),
	recurrence_frequency: z
		.enum(['daily', 'weekly', 'monthly'])
		.nullish()
		.describe('Optional recurrence frequency'),
	recurrence_interval: z
		.number()
		.int()
		.min(1)
		.max(52)
		.nullish()
		.describe('Number of recurrence units between occurrences'),
	voice_channel_id: SnowflakeType.nullish().describe('Optional voice channel associated with the event'),
	external_location: createStringType(0, 300).nullish().describe('Optional external or free-form event location'),
});

function validateEventWindow(
	value: {starts_at?: string; ends_at?: string},
	ctx: z.RefinementCtx,
): void {
	if (value.starts_at !== undefined && value.ends_at !== undefined) {
		if (Date.parse(value.ends_at) <= Date.parse(value.starts_at)) {
			ctx.addIssue({
				code: 'custom',
				path: ['ends_at'],
				message: 'Event end time must be after its start time',
			});
		}
	}
}

export const CalendarEventCreateRequest = CalendarEventFields.superRefine(validateEventWindow);
export type CalendarEventCreateRequest = z.infer<typeof CalendarEventCreateRequest>;

export const CalendarEventUpdateRequest = CalendarEventFields.partial().superRefine(validateEventWindow);
export type CalendarEventUpdateRequest = z.infer<typeof CalendarEventUpdateRequest>;

export const CalendarEventResponse = z.object({
	id: SnowflakeStringType.describe('The event ID'),
	guild_id: SnowflakeStringType.describe('The guild ID'),
	calendar_channel_id: SnowflakeStringType.describe('The calendar channel ID'),
	creator_id: SnowflakeStringType.describe('The user who created the event'),
	name: z.string(),
	description: z.string().nullable(),
	starts_at: z.iso.datetime(),
	ends_at: z.iso.datetime(),
	recurrence_frequency: z.enum(['daily', 'weekly', 'monthly']).nullable(),
	recurrence_interval: Int32Type.nullable(),
	voice_channel_id: SnowflakeStringType.nullable(),
	external_location: z.string().nullable(),
	created_at: z.iso.datetime(),
	updated_at: z.iso.datetime(),
	subscribed: z.boolean().describe('Whether the requesting user is subscribed'),
	subscription_count: Int32Type.describe('Number of users subscribed to the event'),
});

export type CalendarEventResponse = z.infer<typeof CalendarEventResponse>;
export const CalendarEventListResponse = z.array(CalendarEventResponse);
