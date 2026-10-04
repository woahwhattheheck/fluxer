// SPDX-License-Identifier: AGPL-3.0-or-later

import {z} from 'zod';

export const ActivityTypeSchema = z.union([
	z.literal(0),
	z.literal(1),
	z.literal(2),
	z.literal(3),
	z.literal(4),
	z.literal(5),
]);

const ActivityTimestampSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const ActivityTimestampsResponse = z.object({
	start: ActivityTimestampSchema.nullish().describe("Activity start timestamp, preserved in the producer's units"),
	end: ActivityTimestampSchema.nullish().describe("Activity end timestamp, preserved in the producer's units"),
});

export const ActivityAssetsResponse = z.object({
	large_image: z.string().nullish(),
	large_text: z.string().nullish(),
	small_image: z.string().nullish(),
	small_text: z.string().nullish(),
});

export const ActivityResponse = z.object({
	name: z.string().min(1).describe('The activity name'),
	type: ActivityTypeSchema.describe('Activity kind: playing, streaming, listening, watching, custom, or competing'),
	application_id: z.string().nullish().describe('The application identifier supplied by the activity producer'),
	details: z.string().nullish(),
	state: z.string().nullish(),
	timestamps: ActivityTimestampsResponse.nullish(),
	assets: ActivityAssetsResponse.nullish(),
});

export type ActivityResponse = z.infer<typeof ActivityResponse>;
