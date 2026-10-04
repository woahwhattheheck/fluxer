// SPDX-License-Identifier: AGPL-3.0-or-later

import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {matchDetectableApplications, parseDetectables} from '@electron/main/DetectableApplications';
import {listRunningProcesses} from '@electron/main/ActivityProcessScanner';
import {ArRpcServer} from '@electron/main/ArRpcServer';
import {bundledDetectables} from '@electron/main/BundledDetectables';
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
			const payload: unknown = JSON.parse(text);
			const parsed = parseDetectables(payload);
			// Preserve usable overrides, including an intentional empty catalogue.
			if (Array.isArray(payload) && (payload.length === 0 || parsed.length > 0)) {
				this.detectables = parsed;
				return;
			}
		} catch {}
		this.detectables = parseDetectables(bundledDetectables);
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
 * A uniquely matched process can supply a missing RPC name from the catalogue.
 */
export function mergeActivities(
	rpc: Array<RpcActivity>,
	detected: Array<DesktopActivity>,
): Array<DesktopActivity> {
	const namesByPid = new Map<number, string | null>();
	for (const activity of detected) {
		if (activity.kind !== 'detected' || activity.name.trim().length === 0) continue;
		for (const pid of activity.processIds ?? []) {
			if (!isProcessId(pid)) continue;
			const previous = namesByPid.get(pid);
			if (
				previous === undefined ||
				(previous !== null && previous.toLowerCase() === activity.name.toLowerCase())
			) {
				namesByPid.set(pid, activity.name);
			} else {
				// Conflicting catalogue names do not establish an application identity.
				namesByPid.set(pid, null);
			}
		}
	}
	const resolvedRpc = rpc.map((activity) => {
		if (activity.name.trim().length > 0) return activity;
		const name = namesByPid.get(activity.pid);
		// Derive a copy: a later scan must be able to retire an inferred name.
		return name ? {...activity, name} : activity;
	});
	const merged: Array<DesktopActivity> = [...resolvedRpc];
	const rpcNames = new Set(resolvedRpc.map((activity) => activity.name.toLowerCase()));
	const representedPids = new Set(
		resolvedRpc
			.filter((activity) => activity.name.trim().length > 0 && isProcessId(activity.pid))
			.map((activity) => activity.pid),
	);
	for (const activity of detected) {
		if (merged.length >= MAX_ACTIVITIES) break;
		if (activity.kind === 'detected') {
			// Both IPC publication paths use this result. Keep the detector's
			// process list private even when no RPC match was found.
			const {processIds, ...visibleActivity} = activity;
			if (
				rpcNames.has(activity.name.toLowerCase()) ||
				processIds?.some((pid) => representedPids.has(pid))
			) continue;
			merged.push(visibleActivity);
		} else {
			merged.push(activity);
		}
	}
	return merged.slice(0, MAX_ACTIVITIES);
}

function isProcessId(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function defaultDetectablesPath(appDataPath: string): string {
	return path.join(appDataPath, 'detectables.json');
}
