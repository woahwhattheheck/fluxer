// SPDX-License-Identifier: AGPL-3.0-or-later

import {createChannelID} from '@app/api/BrandedTypes';
import {LoginRequired} from '@app/api/middleware/AuthMiddleware';
import {RateLimitMiddleware} from '@app/api/middleware/RateLimitMiddleware';
import {OpenAPI} from '@app/api/middleware/ResponseTypeMiddleware';
import {RateLimitConfigs} from '@app/api/RateLimitConfig';
import type {HonoApp} from '@app/api/types/HonoEnv';
import {Validator} from '@app/api/Validator';
import {ThreadCreateRequest} from '@fluxer/schema/src/domains/channel/ChannelRequestSchemas';
import {ChannelResponse} from '@fluxer/schema/src/domains/channel/ChannelSchemas';
import {ChannelIdParam} from '@fluxer/schema/src/domains/common/CommonParamSchemas';

export function ThreadController(app: HonoApp) {
	app.post(
		'/channels/:channel_id/threads',
		RateLimitMiddleware(RateLimitConfigs.CHANNEL_UPDATE),
		LoginRequired,
		Validator('param', ChannelIdParam),
		Validator('json', ThreadCreateRequest),
		OpenAPI({
			operationId: 'create_public_thread',
			summary: 'Create a public thread',
			requestSchema: ThreadCreateRequest,
			responseSchema: ChannelResponse,
			statusCode: 200,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: 'Channels',
		}),
		async (ctx) => {
			const userId = ctx.get('user').id;
			const parentChannelId = createChannelID(ctx.req.valid('param').channel_id);
			const data = ctx.req.valid('json');
			const requestCache = ctx.get('requestCache');
			return ctx.json(
				await ctx.get('guildService').channels.createPublicThread({userId, parentChannelId, data, requestCache}),
			);
		},
	);

	app.put(
		'/channels/:channel_id/thread-members/@me',
		RateLimitMiddleware(RateLimitConfigs.CHANNEL_UPDATE),
		LoginRequired,
		Validator('param', ChannelIdParam),
		OpenAPI({
			operationId: 'join_public_thread',
			summary: 'Join a public thread',
			responseSchema: null,
			statusCode: 204,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: 'Channels',
		}),
		async (ctx) => {
			const userId = ctx.get('user').id;
			const channelId = createChannelID(ctx.req.valid('param').channel_id);
			const requestCache = ctx.get('requestCache');
			await ctx.get('guildService').channels.joinPublicThread({userId, channelId, requestCache});
			return ctx.body(null, 204);
		},
	);

	app.delete(
		'/channels/:channel_id/thread-members/@me',
		RateLimitMiddleware(RateLimitConfigs.CHANNEL_UPDATE),
		LoginRequired,
		Validator('param', ChannelIdParam),
		OpenAPI({
			operationId: 'leave_public_thread',
			summary: 'Leave a public thread',
			responseSchema: null,
			statusCode: 204,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: 'Channels',
		}),
		async (ctx) => {
			const userId = ctx.get('user').id;
			const channelId = createChannelID(ctx.req.valid('param').channel_id);
			const requestCache = ctx.get('requestCache');
			await ctx.get('guildService').channels.leavePublicThread({userId, channelId, requestCache});
			return ctx.body(null, 204);
		},
	);
}
