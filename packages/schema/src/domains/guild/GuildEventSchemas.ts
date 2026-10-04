// SPDX-License-Identifier: AGPL-3.0-or-later

import {type UserPartial, UserPartialResponse} from '@fluxer/schema/src/domains/user/UserResponseSchemas';
import {IsoTimestampStringType} from '@fluxer/schema/src/primitives/DateValidators';
import {
	createNamedStringLiteralUnion,
	createStringType,
	Int32Type,
	SnowflakeStringType,
	withOpenApiType,
} from '@fluxer/schema/src/primitives/SchemaPrimitives';
import {z} from 'zod';

export const GuildEventRecurrenceUnit = withOpenApiType(
	createNamedStringLiteralUnion(
		[
			['day', 'DAY', 'Repeat every N days'],
			['week', 'WEEK', 'Repeat every N weeks'],
			['month', 'MONTH', 'Repeat every N months'],
		],
		'The unit used by a repeating community event',
	),
	'GuildEventRecurrenceUnit',
);

export const GuildEventRecurrence = z
	.object({
		interval: z.number().int().min(1).max(365).describe('How many recurrence units elapse between occurrences'),
		unit: GuildEventRecurrenceUnit,
	})
	.describe('A repeating schedule expressed as every N days, weeks, or months');

export type GuildEventRecurrence = z.infer<typeof GuildEventRecurrence>;

const GuildEventWritableFields = {
	name: createStringType(1, 100).describe('The event name'),
	description: createStringType(0, 2000).nullable().describe('Optional event description'),
	scheduled_start_time: IsoTimestampStringType.describe('The event start time as an ISO-8601 timestamp'),
	scheduled_end_time: IsoTimestampStringType.describe('The event end time as an ISO-8601 timestamp'),
	channel_id: SnowflakeStringType.nullable().describe('Optional guild channel used as the event location'),
	location: createStringType(0, 256).nullable().describe('Optional free-form location text'),
	recurrence: GuildEventRecurrence.nullable().describe('Repeat schedule, or null for a one-off event'),
} as const;

function validateEventWindow(
	data: {scheduled_start_time?: string; scheduled_end_time?: string},
	ctx: z.RefinementCtx,
): void {
	if (data.scheduled_start_time === undefined || data.scheduled_end_time === undefined) return;
	if (Date.parse(data.scheduled_end_time) <= Date.parse(data.scheduled_start_time)) {
		ctx.addIssue({
			code: 'custom',
			path: ['scheduled_end_time'],
			message: 'Event end time must be after the start time',
		});
	}
}

export const GuildEventCreateRequest = z
	.object({
		...GuildEventWritableFields,
		password: createStringType(1, 128)
			.nullable()
			.optional()
			.describe('Optional password required only by temporary-account event access'),
	})
	.superRefine(validateEventWindow);

export type GuildEventCreateRequest = z.infer<typeof GuildEventCreateRequest>;

export const GuildEventUpdateRequest = z
	.object({
		name: GuildEventWritableFields.name.optional(),
		description: GuildEventWritableFields.description.optional(),
		scheduled_start_time: GuildEventWritableFields.scheduled_start_time.optional(),
		scheduled_end_time: GuildEventWritableFields.scheduled_end_time.optional(),
		channel_id: GuildEventWritableFields.channel_id.optional(),
		location: GuildEventWritableFields.location.optional(),
		recurrence: GuildEventWritableFields.recurrence.optional(),
		password: createStringType(1, 128)
			.nullable()
			.optional()
			.describe('Set, replace, or clear the temporary-account event password'),
	})
	.superRefine(validateEventWindow);

export type GuildEventUpdateRequest = z.infer<typeof GuildEventUpdateRequest>;

export const GuildEventAttendanceUpdateRequest = z.object({
	going: z.boolean().describe('Whether the current user is attending the event'),
});

export type GuildEventAttendanceUpdateRequest = z.infer<typeof GuildEventAttendanceUpdateRequest>;

export const GuildEventResponse = z.object({
	id: SnowflakeStringType.describe('The unique identifier for this event'),
	guild_id: SnowflakeStringType.describe('The guild that owns this event'),
	creator_id: SnowflakeStringType.describe('The user who created this event'),
	name: GuildEventWritableFields.name,
	description: GuildEventWritableFields.description,
	scheduled_start_time: GuildEventWritableFields.scheduled_start_time,
	scheduled_end_time: GuildEventWritableFields.scheduled_end_time,
	channel_id: GuildEventWritableFields.channel_id,
	location: GuildEventWritableFields.location,
	recurrence: GuildEventWritableFields.recurrence,
	attendee_count: Int32Type.describe('The current number of users marked as attending'),
	password_protected: z.boolean().describe('Whether temporary-account access to this event requires a password'),
});

export type GuildEventResponse = z.infer<typeof GuildEventResponse>;
export type GuildEvent = Readonly<GuildEventResponse>;

export const GuildEventListResponse = z.array(GuildEventResponse);

export const GuildEventAttendeeListResponse = z.array(
	UserPartialResponse.describe('A user currently marked as attending the event'),
);

export type GuildEventAttendeeListResponse = z.infer<typeof GuildEventAttendeeListResponse>;
export type GuildEventAttendee = UserPartial;
