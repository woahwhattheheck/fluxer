// SPDX-License-Identifier: AGPL-3.0-or-later

import type {ChannelID, GuildID, UserID} from '@app/api/BrandedTypes';
import {mapChannelToResponse} from '@app/api/channel/ChannelMappers';
import type {IChannelRepository} from '@app/api/channel/IChannelRepository';
import type {GuildAuditLogService} from '@app/api/guild/GuildAuditLogService';
import type {IGuildRepositoryAggregate} from '@app/api/guild/repositories/IGuildRepositoryAggregate';
import {ChannelOperationsService} from '@app/api/guild/services/channel/ChannelOperationsService';
import {createGuildMfaEnforcer} from '@app/api/guild/services/GuildMfaEnforcement';
import type {IGatewayService} from '@app/api/infrastructure/IGatewayService';
import type {ISnowflakeService} from '@app/api/infrastructure/ISnowflakeService';
import type {UserCacheService} from '@app/api/infrastructure/UserCacheService';
import type {LimitConfigService} from '@app/api/limits/LimitConfigService';
import type {RequestCache} from '@app/api/middleware/RequestCacheMiddleware';
import type {IUserRepository} from '@app/api/user/IUserRepository';
import {ChannelTypes, Permissions} from '@fluxer/constants/src/ChannelConstants';
import {UnknownChannelError} from '@fluxer/errors/src/domains/channel/UnknownChannelError';
import {MissingPermissionsError} from '@fluxer/errors/src/domains/core/MissingPermissionsError';
import {UnknownGuildError} from '@fluxer/errors/src/domains/guild/UnknownGuildError';
import type {ChannelCreateRequest, ThreadCreateRequest} from '@fluxer/schema/src/domains/channel/ChannelRequestSchemas';
import type {ChannelResponse} from '@fluxer/schema/src/domains/channel/ChannelSchemas';
import type {ICacheService} from '@pkgs/cache/src/ICacheService';

export class GuildChannelService {
	private readonly channelOps: ChannelOperationsService;

	constructor(
		private readonly channelRepository: IChannelRepository,
		guildRepository: IGuildRepositoryAggregate,
		private readonly userCacheService: UserCacheService,
		private readonly gatewayService: IGatewayService,
		cacheService: ICacheService,
		snowflakeService: ISnowflakeService,
		guildAuditLogService: GuildAuditLogService,
		limitConfigService: LimitConfigService,
		private readonly userRepository: IUserRepository,
	) {
		this.channelOps = new ChannelOperationsService(
			channelRepository,
			guildRepository,
			userCacheService,
			gatewayService,
			cacheService,
			snowflakeService,
			guildAuditLogService,
			limitConfigService,
		);
	}

	async getChannels(params: {
		userId: UserID;
		guildId: GuildID;
		requestCache: RequestCache;
	}): Promise<Array<ChannelResponse>> {
		try {
			await this.gatewayService.getGuildData({guildId: params.guildId, userId: params.userId});
		} catch (error) {
			if (error instanceof UnknownGuildError) {
				throw error;
			}
			throw error;
		}
		const viewableChannelIds = await this.gatewayService.getViewableChannels({
			guildId: params.guildId,
			userId: params.userId,
		});
		const channels = await this.channelRepository.listGuildChannels(params.guildId);
		const viewableChannels = channels.filter(
			(channel) =>
				viewableChannelIds.includes(channel.id) ||
				(channel.type === ChannelTypes.GUILD_PUBLIC_THREAD &&
					channel.parentId != null &&
					viewableChannelIds.includes(channel.parentId)),
		);
		return Promise.all(
			viewableChannels.map((channel) => {
				return mapChannelToResponse({
					channel,
					currentUserId: null,
					userCacheService: this.userCacheService,
					requestCache: params.requestCache,
				});
			}),
		);
	}

	async createChannel(
		params: {
			userId: UserID;
			guildId: GuildID;
			data: ChannelCreateRequest;
			requestCache: RequestCache;
		},
		auditLogReason?: string | null,
	): Promise<ChannelResponse> {
		await this.checkPermission({
			userId: params.userId,
			guildId: params.guildId,
			permission: Permissions.MANAGE_CHANNELS,
		});
		return this.channelOps.createChannel(params, auditLogReason);
	}

	async createPublicThread(params: {
		userId: UserID;
		parentChannelId: ChannelID;
		data: ThreadCreateRequest;
		requestCache: RequestCache;
	}): Promise<ChannelResponse> {
		const parentChannel = await this.channelRepository.findUnique(params.parentChannelId);
		if (!parentChannel || !parentChannel.guildId || parentChannel.type !== ChannelTypes.GUILD_TEXT) {
			throw new UnknownChannelError();
		}
		await this.checkPermission({
			userId: params.userId,
			guildId: parentChannel.guildId,
			channelId: parentChannel.id,
			permission: Permissions.CREATE_PUBLIC_THREADS,
		});
		return this.channelOps.createPublicThread({
			userId: params.userId,
			parentChannel,
			data: params.data,
			requestCache: params.requestCache,
		});
	}

	async joinPublicThread(params: {
		userId: UserID;
		channelId: ChannelID;
		requestCache: RequestCache;
	}): Promise<void> {
		const thread = await this.requirePublicThread(params.channelId);
		await this.checkPermission({
			userId: params.userId,
			guildId: thread.guildId!,
			channelId: thread.parentId!,
			permission: Permissions.VIEW_CHANNEL,
		});
		await this.channelOps.updatePublicThreadMembership({
			thread,
			userId: params.userId,
			joined: true,
			requestCache: params.requestCache,
		});
	}

	async leavePublicThread(params: {
		userId: UserID;
		channelId: ChannelID;
		requestCache: RequestCache;
	}): Promise<void> {
		const thread = await this.requirePublicThread(params.channelId);
		await this.channelOps.updatePublicThreadMembership({
			thread,
			userId: params.userId,
			joined: false,
			requestCache: params.requestCache,
		});
	}

	private async requirePublicThread(channelId: ChannelID) {
		const channel = await this.channelRepository.findUnique(channelId);
		if (
			!channel ||
			channel.type !== ChannelTypes.GUILD_PUBLIC_THREAD ||
			!channel.guildId ||
			!channel.parentId
		) {
			throw new UnknownChannelError();
		}
		return channel;
	}

	async updateChannelPositions(
		params: {
			userId: UserID;
			guildId: GuildID;
			updates: Array<{
				channelId: ChannelID;
				position?: number;
				parentId: ChannelID | null | undefined;
				precedingSiblingId: ChannelID | null | undefined;
				lockPermissions: boolean;
			}>;
			requestCache: RequestCache;
		},
		auditLogReason?: string | null,
	): Promise<void> {
		await this.checkPermission({
			userId: params.userId,
			guildId: params.guildId,
			permission: Permissions.MANAGE_CHANNELS,
		});
		await this.channelOps.updateChannelPositionsByList({
			userId: params.userId,
			guildId: params.guildId,
			updates: params.updates,
			requestCache: params.requestCache,
			auditLogReason: auditLogReason ?? null,
		});
	}

	async sanitizeTextChannelNames(params: {guildId: GuildID; requestCache: RequestCache}): Promise<void> {
		await this.channelOps.sanitizeTextChannelNames(params);
	}

	private async checkPermission(params: {userId: UserID; guildId: GuildID; channelId?: ChannelID; permission: bigint}): Promise<void> {
		const hasPermission = await this.gatewayService.checkPermission({
			guildId: params.guildId,
			userId: params.userId,
			channelId: params.channelId,
			permission: params.permission,
		});
		if (!hasPermission) throw new MissingPermissionsError();
		const guildData = await this.gatewayService.getGuildData({guildId: params.guildId, userId: params.userId});
		const enforceGuildMfa = await createGuildMfaEnforcer({
			userRepository: this.userRepository,
			guildData,
			userId: params.userId,
		});
		enforceGuildMfa(params.permission);
	}
}
