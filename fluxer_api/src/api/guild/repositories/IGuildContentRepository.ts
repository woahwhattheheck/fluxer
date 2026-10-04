// SPDX-License-Identifier: AGPL-3.0-or-later

import type {EmojiID, EventID, GuildID, StickerID, UserID} from '@app/api/BrandedTypes';
import type {GuildEmojiRow, GuildEventAttendeeRow, GuildEventRow, GuildStickerRow} from '@app/api/database/types/GuildTypes';
import type {GuildEmoji} from '@app/api/models/GuildEmoji';
import type {GuildEvent} from '@app/api/models/GuildEvent';
import type {GuildSticker} from '@app/api/models/GuildSticker';

export abstract class IGuildContentRepository {
	abstract getEmoji(emojiId: EmojiID, guildId: GuildID): Promise<GuildEmoji | null>;

	abstract getEmojiById(emojiId: EmojiID): Promise<GuildEmoji | null>;

	abstract listEmojis(guildId: GuildID): Promise<Array<GuildEmoji>>;

	abstract countEmojis(guildId: GuildID): Promise<number>;

	abstract upsertEmoji(data: GuildEmojiRow): Promise<GuildEmoji>;

	abstract deleteEmoji(guildId: GuildID, emojiId: EmojiID): Promise<void>;

	abstract getSticker(stickerId: StickerID, guildId: GuildID): Promise<GuildSticker | null>;

	abstract getStickerById(stickerId: StickerID): Promise<GuildSticker | null>;

	abstract listStickers(guildId: GuildID): Promise<Array<GuildSticker>>;

	abstract countStickers(guildId: GuildID): Promise<number>;

	abstract upsertSticker(data: GuildStickerRow): Promise<GuildSticker>;

	abstract deleteSticker(guildId: GuildID, stickerId: StickerID): Promise<void>;

	abstract getEvent(eventId: EventID, guildId: GuildID): Promise<GuildEvent | null>;

	abstract listEvents(guildId: GuildID): Promise<Array<GuildEvent>>;

	abstract upsertEvent(data: GuildEventRow, oldData?: GuildEventRow | null): Promise<GuildEvent>;

	abstract deleteEvent(guildId: GuildID, eventId: EventID): Promise<void>;

	abstract listEventAttendees(eventId: EventID): Promise<Array<GuildEventAttendeeRow>>;

	abstract listUserEventAttendances(userId: UserID): Promise<Array<GuildEventAttendeeRow>>;

	abstract upsertEventAttendee(data: GuildEventAttendeeRow): Promise<void>;

	abstract deleteEventAttendee(eventId: EventID, userId: UserID): Promise<void>;
}
