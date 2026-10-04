// SPDX-License-Identifier: AGPL-3.0-or-later

import {http} from '@app/features/platform/transport/RestTransport';
import type {Channel} from '@fluxer/schema/src/domains/channel/ChannelSchemas';

export async function createPublicThread(parentChannelId: string, name: string): Promise<Channel> {
	const response = await http.post<Channel>(`/channels/${parentChannelId}/threads`, {
		body: {name},
	});
	return response.body;
}

export async function joinPublicThread(threadId: string): Promise<Channel> {
	const response = await http.put<Channel>(`/channels/${threadId}/thread-members/@me`, {
		body: {},
	});
	return response.body;
}

export async function leavePublicThread(threadId: string): Promise<Channel> {
	const response = await http.delete<Channel>(`/channels/${threadId}/thread-members/@me`);
	return response.body;
}
