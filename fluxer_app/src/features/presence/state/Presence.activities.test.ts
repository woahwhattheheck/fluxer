// SPDX-License-Identifier: AGPL-3.0-or-later

import type {GuildReadyData} from '@app/features/gateway/types/GatewayGuildTypes';
import type {PresenceRecord} from '@app/features/gateway/types/GatewayPresenceTypes';
import type {UserPrivate} from '@fluxer/schema/src/domains/user/UserResponseSchemas';
import {autorun} from 'mobx';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@app/features/auth/state/Authentication', () => ({default: {currentUserId: 'self'}}));
vi.mock('@app/features/channel/state/Channels', () => ({default: {getPrivateChannels: () => []}}));
vi.mock('@app/features/guild/state/Guilds', () => ({default: {getGuild: () => undefined}}));
vi.mock('@app/features/member/state/GuildMembers', () => ({default: {getMember: () => null}}));
vi.mock('@app/features/member/state/MemberSidebar', () => ({default: {handleLocalPresenceUpdate: vi.fn()}}));
vi.mock('@app/features/platform/utils/AppLogger', () => ({
	Logger: class {
		error() {}
	},
}));
vi.mock('@app/features/platform/utils/DeferUntilModulesLoaded', () => ({deferUntilModulesLoaded: () => {}}));
vi.mock('@app/features/presence/state/LocalPresence', () => ({
	default: {status: 'online', customStatus: null, getStatus: () => 'online'},
}));
vi.mock('@app/features/presence/state/TransientPresence', () => ({default: {clear: vi.fn(), clearPresence: vi.fn()}}));
vi.mock('@app/features/relationship/state/Relationships', () => ({default: {getRelationships: () => []}}));
vi.mock('@app/features/ui/state/MobileLayout', () => ({default: {isMobileLayout: () => false}}));
vi.mock('@app/features/user/state/CustomStatus', () => ({fromGatewayCustomStatus: () => null}));
vi.mock('@app/features/user/state/CustomStatusEmitter', () => ({CustomStatusEmitter: {emitPresenceChange: vi.fn()}}));

const {default: Presence} = await import('@app/features/presence/state/Presence');

const activity = {name: 'Example game', type: 0 as const, details: 'In a match'};
const remoteUser = {id: 'remote'} as PresenceRecord['user'];
const self = {id: 'self'} as UserPrivate;

function presence(overrides: Partial<PresenceRecord> = {}): PresenceRecord {
	return {user: remoteUser, guild_id: 'guild-a', status: 'online', activities: [activity], ...overrides};
}

beforeEach(() => Presence.handleSessionInvalidated());
afterEach(() => Presence.handleSessionInvalidated());

describe('Presence activity delivery', () => {
	it('receives activity snapshots and observes replacements independently of status changes', () => {
		const observed: Array<Array<string>> = [];
		const dispose = autorun(() => observed.push(Presence.getActivities('remote').map((item) => item.name)));
		try {
			Presence.handlePresenceUpdate(presence());
			Presence.handlePresenceUpdate(presence({activities: [{name: 'Example song', type: 2}]}));
			expect(Presence.getActivities('remote')).toEqual([{name: 'Example song', type: 2}]);
			expect(Presence.getStatus('remote')).toBe('online');
			expect(Presence.getPresenceCount('guild-a')).toBe(1);
			expect(observed).toEqual([[], ['Example game'], ['Example song']]);
		} finally {
			dispose();
		}
	});

	it.each([undefined, null, []])('clears a prior activity on a legacy or empty snapshot (%s)', (activities) => {
		Presence.handlePresenceUpdate(presence());
		Presence.handlePresenceUpdate(presence({activities}));
		expect(Presence.getActivities('remote')).toEqual([]);
		expect(Presence.getStatus('remote')).toBe('online');
	});

	it.each(['offline', 'invisible'])('does not retain activities in %s presence', (status) => {
		Presence.handlePresenceUpdate(presence());
		Presence.handlePresenceUpdate(presence({status}));
		expect(Presence.getActivities('remote')).toEqual([]);
		expect(Presence.getPresenceCount('guild-a')).toBe(0);
		Presence.handlePresenceUpdate(presence({activities: undefined}));
		expect(Presence.getActivities('remote')).toEqual([]);
	});

	it('keeps valid activities while rejecting malformed siblings and stripping unknown fields', () => {
		const activities = [null, {name: 'Bad type', type: 9}, {...activity, secret: 'discard'}];
		Presence.handlePresenceUpdate(presence({activities: activities as unknown as PresenceRecord['activities']}));
		expect(Presence.getActivities('remote')).toEqual([activity]);
		Presence.handlePresenceUpdate(presence({activities: {} as PresenceRecord['activities']}));
		expect(Presence.getActivities('remote')).toEqual([]);
	});

	it('hydrates READY, clears on reconnect, and clears on session invalidation', () => {
		const guilds = [{id: 'guild-a', members: [{user: remoteUser}]}] as Array<GuildReadyData>;
		Presence.handleGatewayReady(self, guilds, [presence()]);
		expect(Presence.getActivities('remote')).toEqual([activity]);
		Presence.handleGatewayReady(self, guilds);
		expect(Presence.getActivities('remote')).toEqual([]);
		Presence.handlePresenceUpdate(presence());
		Presence.handleSessionInvalidated();
		expect(Presence.getActivities('remote')).toEqual([]);
	});

	it('preserves activities while one shared guild remains and evicts after the last guild is removed', () => {
		Presence.handlePresenceUpdate(presence());
		Presence.handleGuildMemberAdd('guild-b', 'remote');
		Presence.handleGuildMemberRemove('guild-a', 'remote');
		expect(Presence.getActivities('remote')).toEqual([activity]);
		Presence.handleGuildDelete('guild-b');
		expect(Presence.getActivities('remote')).toEqual([]);
	});

	it('does not let remote snapshots replace the local user activity state', () => {
		Presence.handlePresenceUpdate(presence({user: {id: 'self'} as PresenceRecord['user']}));
		expect(Presence.getActivities('self')).toEqual([]);
	});
});
