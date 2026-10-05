// SPDX-License-Identifier: AGPL-3.0-or-later

import type {EventID, GuildID, UserID} from '@app/api/BrandedTypes';
import {BatchBuilder, fetchMany, fetchOne, upsertOne} from '@app/api/database/CassandraQueryExecution';
import type {
	CalendarEventRow,
	CalendarEventSubscriptionByUserRow,
	CalendarEventSubscriptionRow,
} from '@app/api/database/types/CalendarTypes';
import {
	CalendarEvents,
	CalendarEventSubscriptions,
	CalendarEventSubscriptionsByUser,
} from '@app/api/Tables';

const FETCH_EVENT_CQL = CalendarEvents.selectCql({
	where: [CalendarEvents.where.eq('guild_id'), CalendarEvents.where.eq('event_id')],
	limit: 1,
});

const LIST_GUILD_EVENTS_CQL = CalendarEvents.selectCql({
	where: CalendarEvents.where.eq('guild_id'),
});

const FETCH_SUBSCRIPTION_CQL = CalendarEventSubscriptions.selectCql({
	where: [
		CalendarEventSubscriptions.where.eq('event_id'),
		CalendarEventSubscriptions.where.eq('user_id'),
	],
	limit: 1,
});

const LIST_EVENT_SUBSCRIPTIONS_CQL = CalendarEventSubscriptions.selectCql({
	where: CalendarEventSubscriptions.where.eq('event_id'),
});

const LIST_USER_SUBSCRIPTIONS_CQL = CalendarEventSubscriptionsByUser.selectCql({
	where: CalendarEventSubscriptionsByUser.where.eq('user_id'),
});

export class CalendarEventRepository {
	async find(guildId: GuildID, eventId: EventID): Promise<CalendarEventRow | null> {
		return await fetchOne<CalendarEventRow>(FETCH_EVENT_CQL, {
			guild_id: guildId,
			event_id: eventId,
		});
	}

	async listByGuild(guildId: GuildID): Promise<Array<CalendarEventRow>> {
		return await fetchMany<CalendarEventRow>(LIST_GUILD_EVENTS_CQL, {guild_id: guildId});
	}

	async upsert(row: CalendarEventRow): Promise<void> {
		await upsertOne(CalendarEvents.upsertAll(row));
	}

	async delete(guildId: GuildID, eventId: EventID): Promise<void> {
		const subscriptions = await this.listSubscriptions(eventId);
		const batch = new BatchBuilder();
		batch.addPrepared(CalendarEvents.deleteByPk({guild_id: guildId, event_id: eventId}));
		for (const subscription of subscriptions) {
			batch.addPrepared(
				CalendarEventSubscriptions.deleteByPk({
					event_id: eventId,
					user_id: subscription.user_id,
				}),
			);
			batch.addPrepared(
				CalendarEventSubscriptionsByUser.deleteByPk({
					user_id: subscription.user_id,
					event_id: eventId,
				}),
			);
		}
		await batch.execute();
	}

	async isSubscribed(eventId: EventID, userId: UserID): Promise<boolean> {
		return (
			(await fetchOne<CalendarEventSubscriptionRow>(FETCH_SUBSCRIPTION_CQL, {
				event_id: eventId,
				user_id: userId,
			})) !== null
		);
	}

	async listSubscriptions(eventId: EventID): Promise<Array<CalendarEventSubscriptionRow>> {
		return await fetchMany<CalendarEventSubscriptionRow>(LIST_EVENT_SUBSCRIPTIONS_CQL, {event_id: eventId});
	}

	async listSubscriptionsByUser(userId: UserID): Promise<Array<CalendarEventSubscriptionByUserRow>> {
		return await fetchMany<CalendarEventSubscriptionByUserRow>(LIST_USER_SUBSCRIPTIONS_CQL, {user_id: userId});
	}

	async subscribe(params: {eventId: EventID; userId: UserID; guildId: GuildID; subscribedAt: Date}): Promise<void> {
		const row: CalendarEventSubscriptionRow = {
			event_id: params.eventId,
			user_id: params.userId,
			guild_id: params.guildId,
			subscribed_at: params.subscribedAt,
		};
		const byUser: CalendarEventSubscriptionByUserRow = {
			user_id: params.userId,
			event_id: params.eventId,
			guild_id: params.guildId,
			subscribed_at: params.subscribedAt,
		};
		const batch = new BatchBuilder();
		batch.addPrepared(CalendarEventSubscriptions.upsertAll(row));
		batch.addPrepared(CalendarEventSubscriptionsByUser.upsertAll(byUser));
		await batch.execute();
	}

	async unsubscribe(eventId: EventID, userId: UserID): Promise<void> {
		const batch = new BatchBuilder();
		batch.addPrepared(CalendarEventSubscriptions.deleteByPk({event_id: eventId, user_id: userId}));
		batch.addPrepared(CalendarEventSubscriptionsByUser.deleteByPk({user_id: userId, event_id: eventId}));
		await batch.execute();
	}
}
