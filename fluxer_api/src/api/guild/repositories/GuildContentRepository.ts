// SPDX-License-Identifier: AGPL-3.0-or-later

import type {EmojiID, EventID, GuildID, StickerID, UserID} from '@app/api/BrandedTypes';
import {BatchBuilder, fetchMany, fetchOne, upsertOne} from '@app/api/database/CassandraQueryExecution';
import {buildPatchFromData, executeVersionedUpdate} from '@app/api/database/CassandraVersionedUpdate';
import {
	GUILD_EMOJI_COLUMNS,
	GUILD_EVENT_COLUMNS,
	GUILD_STICKER_COLUMNS,
	type GuildEmojiRow,
	type GuildEventAttendeeRow,
	type GuildEventRow,
	type GuildStickerRow,
} from '@app/api/database/types/GuildTypes';
import {IGuildContentRepository} from '@app/api/guild/repositories/IGuildContentRepository';
import {GuildEmoji} from '@app/api/models/GuildEmoji';
import {GuildEvent} from '@app/api/models/GuildEvent';
import {GuildSticker} from '@app/api/models/GuildSticker';
import {
	GuildEmojis,
	GuildEmojisByEmojiId,
	GuildEventAttendees,
	GuildEventAttendeesByUser,
	GuildEvents,
	GuildStickers,
	GuildStickersByStickerId,
} from '@app/api/Tables';

const FETCH_GUILD_EMOJIS_BY_GUILD_ID_QUERY = GuildEmojis.selectCql({
	where: GuildEmojis.where.eq('guild_id'),
});
const FETCH_GUILD_EMOJI_BY_ID_QUERY = GuildEmojis.selectCql({
	where: [GuildEmojis.where.eq('guild_id'), GuildEmojis.where.eq('emoji_id')],
	limit: 1,
});
const FETCH_GUILD_EMOJI_BY_EMOJI_ID_ONLY_QUERY = GuildEmojisByEmojiId.selectCql({
	where: GuildEmojisByEmojiId.where.eq('emoji_id'),
	limit: 1,
});
const FETCH_GUILD_STICKERS_BY_GUILD_ID_QUERY = GuildStickers.selectCql({
	where: GuildStickers.where.eq('guild_id'),
});
const FETCH_GUILD_STICKER_BY_ID_QUERY = GuildStickers.selectCql({
	where: [GuildStickers.where.eq('guild_id'), GuildStickers.where.eq('sticker_id')],
	limit: 1,
});
const FETCH_GUILD_STICKER_BY_STICKER_ID_ONLY_QUERY = GuildStickersByStickerId.selectCql({
	where: GuildStickersByStickerId.where.eq('sticker_id'),
	limit: 1,
});
const FETCH_GUILD_EVENTS_BY_GUILD_ID_QUERY = GuildEvents.selectCql({
	where: GuildEvents.where.eq('guild_id'),
});
const FETCH_GUILD_EVENT_BY_ID_QUERY = GuildEvents.selectCql({
	where: [GuildEvents.where.eq('guild_id'), GuildEvents.where.eq('event_id')],
	limit: 1,
});
const FETCH_GUILD_EVENT_ATTENDEES_QUERY = GuildEventAttendees.selectCql({
	where: GuildEventAttendees.where.eq('event_id'),
});
const FETCH_USER_EVENT_ATTENDANCES_QUERY = GuildEventAttendeesByUser.selectCql({
	where: GuildEventAttendeesByUser.where.eq('user_id'),
});

export class GuildContentRepository extends IGuildContentRepository {
	async getEmoji(emojiId: EmojiID, guildId: GuildID): Promise<GuildEmoji | null> {
		const emoji = await fetchOne<GuildEmojiRow>(FETCH_GUILD_EMOJI_BY_ID_QUERY, {
			guild_id: guildId,
			emoji_id: emojiId,
		});
		return emoji ? new GuildEmoji(emoji) : null;
	}

	async getEmojiById(emojiId: EmojiID): Promise<GuildEmoji | null> {
		const emoji = await fetchOne<GuildEmojiRow>(FETCH_GUILD_EMOJI_BY_EMOJI_ID_ONLY_QUERY, {
			emoji_id: emojiId,
		});
		return emoji ? new GuildEmoji(emoji) : null;
	}

	async listEmojis(guildId: GuildID): Promise<Array<GuildEmoji>> {
		const emojis = await fetchMany<GuildEmojiRow>(FETCH_GUILD_EMOJIS_BY_GUILD_ID_QUERY, {
			guild_id: guildId,
		});
		return emojis.map((emoji) => new GuildEmoji(emoji));
	}

	async countEmojis(guildId: GuildID): Promise<number> {
		const emojis = await fetchMany<GuildEmojiRow>(FETCH_GUILD_EMOJIS_BY_GUILD_ID_QUERY, {
			guild_id: guildId,
		});
		return emojis.length;
	}

	async upsertEmoji(data: GuildEmojiRow, oldData?: GuildEmojiRow | null): Promise<GuildEmoji> {
		const guildId = data.guild_id;
		const emojiId = data.emoji_id;
		const result = await executeVersionedUpdate<GuildEmojiRow, 'guild_id' | 'emoji_id'>(
			async () =>
				fetchOne<GuildEmojiRow>(FETCH_GUILD_EMOJI_BY_ID_QUERY, {
					guild_id: guildId,
					emoji_id: emojiId,
				}),
			(current) => ({
				pk: {guild_id: guildId, emoji_id: emojiId},
				patch: buildPatchFromData(data, current, GUILD_EMOJI_COLUMNS, ['guild_id', 'emoji_id']),
			}),
			GuildEmojis,
			{initialData: oldData},
		);
		await upsertOne(GuildEmojisByEmojiId.insert(data));
		return new GuildEmoji({...data, version: result.finalVersion ?? 1});
	}

	async deleteEmoji(guildId: GuildID, emojiId: EmojiID): Promise<void> {
		const batch = new BatchBuilder();
		batch.addPrepared(
			GuildEmojis.deleteByPk({
				guild_id: guildId,
				emoji_id: emojiId,
			}),
		);
		batch.addPrepared(GuildEmojisByEmojiId.deleteByPk({emoji_id: emojiId}));
		await batch.execute();
	}

	async getSticker(stickerId: StickerID, guildId: GuildID): Promise<GuildSticker | null> {
		const sticker = await fetchOne<GuildStickerRow>(FETCH_GUILD_STICKER_BY_ID_QUERY, {
			guild_id: guildId,
			sticker_id: stickerId,
		});
		return sticker ? new GuildSticker(sticker) : null;
	}

	async getStickerById(stickerId: StickerID): Promise<GuildSticker | null> {
		const sticker = await fetchOne<GuildStickerRow>(FETCH_GUILD_STICKER_BY_STICKER_ID_ONLY_QUERY, {
			sticker_id: stickerId,
		});
		return sticker ? new GuildSticker(sticker) : null;
	}

	async listStickers(guildId: GuildID): Promise<Array<GuildSticker>> {
		const stickers = await fetchMany<GuildStickerRow>(FETCH_GUILD_STICKERS_BY_GUILD_ID_QUERY, {
			guild_id: guildId,
		});
		return stickers.map((sticker) => new GuildSticker(sticker));
	}

	async countStickers(guildId: GuildID): Promise<number> {
		const stickers = await fetchMany<GuildStickerRow>(FETCH_GUILD_STICKERS_BY_GUILD_ID_QUERY, {
			guild_id: guildId,
		});
		return stickers.length;
	}

	async upsertSticker(data: GuildStickerRow, oldData?: GuildStickerRow | null): Promise<GuildSticker> {
		const guildId = data.guild_id;
		const stickerId = data.sticker_id;
		const result = await executeVersionedUpdate<GuildStickerRow, 'guild_id' | 'sticker_id'>(
			async () =>
				fetchOne<GuildStickerRow>(FETCH_GUILD_STICKER_BY_ID_QUERY, {
					guild_id: guildId,
					sticker_id: stickerId,
				}),
			(current) => ({
				pk: {guild_id: guildId, sticker_id: stickerId},
				patch: buildPatchFromData(data, current, GUILD_STICKER_COLUMNS, ['guild_id', 'sticker_id']),
			}),
			GuildStickers,
			{initialData: oldData},
		);
		await upsertOne(GuildStickersByStickerId.insert(data));
		return new GuildSticker({...data, version: result.finalVersion ?? 1});
	}

	async deleteSticker(guildId: GuildID, stickerId: StickerID): Promise<void> {
		const batch = new BatchBuilder();
		batch.addPrepared(
			GuildStickers.deleteByPk({
				guild_id: guildId,
				sticker_id: stickerId,
			}),
		);
		batch.addPrepared(GuildStickersByStickerId.deleteByPk({sticker_id: stickerId}));
		await batch.execute();
	}

	async getEvent(eventId: EventID, guildId: GuildID): Promise<GuildEvent | null> {
		const row = await fetchOne<GuildEventRow>(FETCH_GUILD_EVENT_BY_ID_QUERY, {
			guild_id: guildId,
			event_id: eventId,
		});
		return row ? new GuildEvent(row) : null;
	}

	async listEvents(guildId: GuildID): Promise<Array<GuildEvent>> {
		const rows = await fetchMany<GuildEventRow>(FETCH_GUILD_EVENTS_BY_GUILD_ID_QUERY, {guild_id: guildId});
		return rows.map((row) => new GuildEvent(row));
	}

	async upsertEvent(data: GuildEventRow, oldData?: GuildEventRow | null): Promise<GuildEvent> {
		const guildId = data.guild_id;
		const eventId = data.event_id;
		const result = await executeVersionedUpdate<GuildEventRow, 'guild_id' | 'event_id'>(
			async () =>
				fetchOne<GuildEventRow>(FETCH_GUILD_EVENT_BY_ID_QUERY, {
					guild_id: guildId,
					event_id: eventId,
				}),
			(current) => ({
				pk: {guild_id: guildId, event_id: eventId},
				patch: buildPatchFromData(data, current, GUILD_EVENT_COLUMNS, ['guild_id', 'event_id']),
			}),
			GuildEvents,
			{initialData: oldData},
		);
		return new GuildEvent({...data, version: result.finalVersion ?? 1});
	}

	async deleteEvent(guildId: GuildID, eventId: EventID): Promise<void> {
		const attendees = await this.listEventAttendees(eventId);
		const BATCH_SIZE = 50;
		for (let i = 0; i < attendees.length; i += BATCH_SIZE) {
			const batch = new BatchBuilder();
			for (const attendee of attendees.slice(i, i + BATCH_SIZE)) {
				batch.addPrepared(GuildEventAttendees.deleteByPk({event_id: eventId, user_id: attendee.user_id}));
				batch.addPrepared(
					GuildEventAttendeesByUser.deleteByPk({user_id: attendee.user_id, event_id: eventId}),
				);
			}
			await batch.execute();
		}
		await GuildEvents.deleteByPk({guild_id: guildId, event_id: eventId}).execute();
	}

	async listEventAttendees(eventId: EventID): Promise<Array<GuildEventAttendeeRow>> {
		return await fetchMany<GuildEventAttendeeRow>(FETCH_GUILD_EVENT_ATTENDEES_QUERY, {event_id: eventId});
	}

	async listUserEventAttendances(userId: UserID): Promise<Array<GuildEventAttendeeRow>> {
		return await fetchMany<GuildEventAttendeeRow>(FETCH_USER_EVENT_ATTENDANCES_QUERY, {user_id: userId});
	}

	async upsertEventAttendee(data: GuildEventAttendeeRow): Promise<void> {
		await Promise.all([
			upsertOne(GuildEventAttendees.insert(data)),
			upsertOne(GuildEventAttendeesByUser.insert(data)),
		]);
	}

	async deleteEventAttendee(eventId: EventID, userId: UserID): Promise<void> {
		const batch = new BatchBuilder();
		batch.addPrepared(GuildEventAttendees.deleteByPk({event_id: eventId, user_id: userId}));
		batch.addPrepared(GuildEventAttendeesByUser.deleteByPk({user_id: userId, event_id: eventId}));
		await batch.execute();
	}
}
