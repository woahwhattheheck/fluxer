// SPDX-License-Identifier: AGPL-3.0-or-later

import {createServer, type Server, type Socket} from 'node:net';
import {homedir} from 'node:os';
import path from 'node:path';
import type {RpcActivity} from '@electron/common/RpcActivityTypes';

/**
 * Discord-compatible local RPC server (arRPC protocol shape).
 *
 * Games and tools that already speak Discord Rich Presence connect to the
 * well-known pipe/socket path, handshake, then send SET_ACTIVITY frames.
 * Only the subset Fluxer needs is implemented: HANDSHAKE, PING, and
 * SET_ACTIVITY (including `activity: null` to clear). When a client
 * disconnects its activity is cleared so presence never goes stale.
 */

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

const PIPE_COUNT = 10;

export interface RpcServerEvents {
	onActivity: (activity: RpcActivity | null, pid: number) => void;
}

interface ClientState {
	socket: Socket;
	pid: number;
	buffer: Buffer;
}

function pipePaths(platform: NodeJS.Platform): Array<string> {
	if (platform === 'win32') {
		return Array.from({length: PIPE_COUNT}, (_, index) => `\\\\.\\pipe\\discord-ipc-${index}`);
	}
	const runtimeDir =
		process.env.XDG_RUNTIME_DIR ?? process.env.TMPDIR ?? `/tmp`;
	const prefix = process.env.XDG_RUNTIME_DIR
		? path.join(runtimeDir, 'discord-ipc')
		: path.join(runtimeDir, 'discord-ipc');
	return Array.from({length: PIPE_COUNT}, (_, index) => `${prefix}-${index}`);
}

function encodeMessage(op: number, payload: unknown): Buffer {
	const body = Buffer.from(JSON.stringify(payload), 'utf8');
	const header = Buffer.alloc(8);
	header.writeUInt32LE(op, 0);
	header.writeUInt32LE(body.length, 4);
	return Buffer.concat([header, body]);
}

interface ParsedMessage {
	op: number;
	payload: string;
}

function tryDecodeMessage(buffer: Buffer, offset: number): ParsedMessage | null {
	if (buffer.length - offset < 8) return null;
	const op = buffer.readUInt32LE(offset);
	const length = buffer.readUInt32LE(offset + 4);
	if (buffer.length - offset - 8 < length) return null;
	return {op, payload: buffer.toString('utf8', offset + 8, offset + 8 + length)};
}

export class ArRpcServer {
	private readonly events: RpcServerEvents;
	private readonly servers = new Set<Server>();
	private readonly clients = new Set<ClientState>();
	private readonly activities = new Map<number, RpcActivity>();
	private started = false;

	constructor(events: RpcServerEvents) {
		this.events = events;
	}

	async start(): Promise<void> {
		if (this.started) return;
		this.started = true;
		const paths = pipePaths(process.platform);
		const attempts = paths.map(
			(pathName) =>
				new Promise<void>((resolve) => {
					const server = createServer((socket) => this.handleConnection(socket));
					server.once('error', () => resolve());
					server.listen(pathName, () => {
						this.servers.add(server);
						resolve();
					});
				}),
		);
		await Promise.all(attempts);
	}

	async stop(): Promise<void> {
		this.started = false;
		for (const client of this.clients) client.socket.destroy();
		this.clients.clear();
		this.activities.clear();
		await Promise.all(
			[...this.servers].map(
				(server) => new Promise<void>((resolve) => server.close(() => resolve())),
			),
		);
		this.servers.clear();
	}

	currentActivities(): Array<RpcActivity> {
		return [...this.activities.values()];
	}

	private handleConnection(socket: Socket): void {
		const state: ClientState = {socket, pid: 0, buffer: Buffer.alloc(0)};
		this.clients.add(state);
		socket.on('data', (chunk: Buffer) => this.handleData(state, chunk));
		socket.on('close', () => this.handleDisconnect(state));
		socket.on('error', () => this.handleDisconnect(state));
	}

	private handleDisconnect(state: ClientState): void {
		if (!this.clients.has(state)) return;
		this.clients.delete(state);
		if (state.pid !== 0 && this.activities.delete(state.pid)) {
			this.events.onActivity(null, state.pid);
		}
	}

	private handleData(state: ClientState, chunk: Buffer): void {
		state.buffer = Buffer.concat([state.buffer, chunk]);
		for (;;) {
			const decoded = tryDecodeMessage(state.buffer, 0);
			if (decoded == null) return;
			state.buffer = state.buffer.subarray(8 + decoded.payload.length);
			this.handleMessage(state, decoded.op, decoded.payload);
		}
	}

	private handleMessage(state: ClientState, op: number, payload: string): void {
		let parsed: unknown;
		try {
			parsed = payload.length === 0 ? {} : JSON.parse(payload);
		} catch {
			// ignore malformed frames
		}
		const data = (parsed ?? {}) as {
			client_id?: unknown;
			pid?: unknown;
			activity?: unknown;
			args?: {pid?: unknown; activity?: unknown} | null;
		};
		switch (op) {
			case OP_HANDSHAKE:
				state.pid = typeof data.pid === 'number' ? data.pid : 0;
				state.socket.write(encodeMessage(OP_FRAME, {cmd: 'DISPATCH', data: {v: 1, cfg: {}}}));
				break;
			case OP_PING:
				state.socket.write(encodeMessage(OP_PONG, {}));
				break;
			case OP_FRAME: {
				// Discord clients wrap the payload in `args`; bare activity is
				// accepted too for minimal test clients.
				const rawActivity = data.args?.activity !== undefined ? data.args.activity : data.activity;
				const activity = normalizeActivity(rawActivity, state.pid);
				if (activity == null) {
					if (this.activities.delete(state.pid)) this.events.onActivity(null, state.pid);
				} else {
					this.activities.set(state.pid, activity);
					this.events.onActivity(activity, state.pid);
				}
				break;
			}
			default:
				break;
		}
	}
}

function normalizeActivity(raw: unknown, pid: number): RpcActivity | null {
	if (typeof raw !== 'object' || raw == null) return null;
	const activity = raw as {
		name?: unknown;
		type?: unknown;
		state?: unknown;
		details?: unknown;
		assets?: unknown;
		timestamps?: unknown;
	};
	if (activity.name != null && typeof activity.name !== 'string') return null;
	if (activity.type != null && typeof activity.type !== 'number') return null;
	const assets =
		typeof activity.assets === 'object' && activity.assets != null
			? normalizeAssets(activity.assets as Record<string, unknown>)
			: null;
	const timestamps =
		typeof activity.timestamps === 'object' && activity.timestamps != null
			? normalizeTimestamps(activity.timestamps as Record<string, unknown>)
			: null;
	return {
		kind: 'rpc',
		pid,
		name: typeof activity.name === 'string' ? activity.name : '',
		type: typeof activity.type === 'number' ? activity.type : 0,
		...(typeof activity.state === 'string' ? {state: activity.state} : {state: null}),
		...(typeof activity.details === 'string' ? {details: activity.details} : {details: null}),
		...(assets ? {assets} : {assets: null}),
		...(timestamps ? {timestamps} : {timestamps: null}),
	};
}

function normalizeAssets(raw: Record<string, unknown>): RpcActivity['assets'] {
	const pick = (key: string): string | null =>
		typeof raw[key] === 'string' ? (raw[key] as string) : null;
	return {
		large_image: pick('large_image'),
		large_text: pick('large_text'),
		small_image: pick('small_image'),
		small_text: pick('small_text'),
	};
}

function normalizeTimestamps(raw: Record<string, unknown>): RpcActivity['timestamps'] {
	const pick = (key: string): number | null =>
		typeof raw[key] === 'number' && Number.isFinite(raw[key] as number)
			? (raw[key] as number)
			: null;
	return {start: pick('start'), end: pick('end')};
}

export const __rpcInternals = {
	encodeMessage,
	tryDecodeMessage,
	normalizeActivity,
	OP_HANDSHAKE,
	OP_FRAME,
	OP_PING,
	OP_PONG,
};
