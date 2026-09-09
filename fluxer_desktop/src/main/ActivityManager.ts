// SPDX-License-Identifier: AGPL-3.0-or-later

import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {matchDetectableApplications, parseDetectables} from '@electron/main/DetectableApplications';
import {listRunningProcesses} from '@electron/main/ActivityProcessScanner';
import {ArRpcServer} from '@electron/main/ArRpcServer';
import type {DesktopActivity, RpcActivity} from '@electron/common/RpcActivityTypes';

/**
 * Owns every activity source and produces one merged activity list.
 *
 * Priority per the design discussion in fluxer-meta #8: an explicit RPC
 * activity always wins over automatic process detection for the same
 * application, and detection never overrides a live RPC client.
 */

const PROCESS_POLL_INTERVAL_MS = 15_000;
const MAX_ACTIVITIES = 5;

export interface ActivityManagerOptions {
	/** Resolved `detectables.json` path. */
	detectablesPath: string;
	/** Called whenever the merged activity list changes. */
	onChange: (activities: Array<DesktopActivity>) => void;
	pollIntervalMs?: number;
	fetchDetectables?: () => Promise<string>;
	listProcesses?: () => Promise<Array<import('@electron/common/RpcActivityTypes').DetectedProcess>>;
}

export class ActivityManager {
	private readonly options: ActivityManagerOptions;
	private readonly rpcServer: ArRpcServer;
	private readonly rpcActivities = new Map<number, RpcActivity>();
	private detectedActivities: Array<DesktopActivity> = [];
	private pollTimer: NodeJS.Timeout | null = null;
	private detectables: Array<import('@electron/common/RpcActivityTypes').DetectableApplication> = [];
	private lastEmittedKey = '';

	constructor(options: ActivityManagerOptions) {
		this.options = options;
		this.rpcServer = new ArRpcServer({
			onActivity: (activity, pid) => {
				if (activity == null) {
					this.rpcActivities.delete(pid);
				} else {
					this.rpcActivities.set(pid, activity);
				}
				this.emit();
			},
		});
	}

	async start(): Promise<void> {
		await this.loadDetectables();
		await this.rpcServer.start();
		await this.refreshDetected();
		this.pollTimer = setInterval(() => {
			void this.refreshDetected();
		}, this.options.pollIntervalMs ?? PROCESS_POLL_INTERVAL_MS);
		this.pollTimer.unref?.();
	}

	async stop(): Promise<void> {
		if (this.pollTimer != null) clearInterval(this.pollTimer);
		this.pollTimer = null;
		this.detectedActivities = [];
		this.rpcActivities.clear();
		await this.rpcServer.stop();
		this.emit();
	}

	currentActivities(): Array<DesktopActivity> {
		return mergeActivities([...this.rpcActivities.values()], this.detectedActivities);
	}

	private async loadDetectables(): Promise<void> {
		const fetchText = this.options.fetchDetectables ?? (() => readFile(this.options.detectablesPath, 'utf8'));
		try {
			const text = await fetchText();
			this.detectables = parseDetectables(JSON.parse(text));
		} catch {
			this.detectables = [];
		}
	}

	private async refreshDetected(): Promise<void> {
		const lister = this.options.listProcesses ?? listRunningProcesses;
		let processes: Array<import('@electron/common/RpcActivityTypes').DetectedProcess> = [];
		try {
			processes = await lister();
		} catch {
			processes = [];
		}
		this.detectedActivities = matchDetectableApplications(this.detectables, processes, process.platform);
		this.emit();
	}

	private emit(): void {
		const activities = this.currentActivities();
		const key = JSON.stringify(activities);
		if (key === this.lastEmittedKey) return;
		this.lastEmittedKey = key;
		this.options.onChange(activities);
	}
}

/**
 * RPC activities first (explicit presence from the game itself), then detected
 * applications whose executable is not already represented by an RPC client.
 */
export function mergeActivities(
	rpc: Array<RpcActivity>,
	detected: Array<DesktopActivity>,
): Array<DesktopActivity> {
	const merged: Array<DesktopActivity> = [...rpc];
	const rpcNames = new Set(rpc.map((activity) => activity.name.toLowerCase()));
	for (const activity of detected) {
		if (merged.length >= MAX_ACTIVITIES) break;
		if (activity.kind === 'detected' && rpcNames.has(activity.name.toLowerCase())) continue;
		merged.push(activity);
	}
	return merged.slice(0, MAX_ACTIVITIES);
}

export function defaultDetectablesPath(appDataPath: string): string {
	return path.join(appDataPath, 'detectables.json');
}
