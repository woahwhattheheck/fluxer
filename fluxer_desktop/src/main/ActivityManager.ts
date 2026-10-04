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
	private running = false;
	private lifecycleVersion = 0;
	private detectionVersion = 0;
	private publishedDetectionVersion = 0;
	private rpcLifecycle: Promise<void> = Promise.resolve();

	constructor(options: ActivityManagerOptions) {
		this.options = options;
		this.rpcServer = new ArRpcServer({
			onActivity: (activity, pid) => {
				if (!this.running) return;
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
		const lifecycle = ++this.lifecycleVersion;
		this.running = true;
		if (this.pollTimer != null) clearInterval(this.pollTimer);
		this.pollTimer = null;
		const detectables = await this.loadDetectables();
		if (lifecycle !== this.lifecycleVersion) return;
		this.detectables = detectables;
		await this.enqueueRpc(async () => {
			if (lifecycle === this.lifecycleVersion) await this.rpcServer.start();
		});
		if (lifecycle !== this.lifecycleVersion) return;
		await this.refreshDetected();
		if (lifecycle !== this.lifecycleVersion) return;
		this.pollTimer = setInterval(() => {
			void this.refreshDetected();
		}, this.options.pollIntervalMs ?? PROCESS_POLL_INTERVAL_MS);
		this.pollTimer.unref?.();
	}

	async stop(): Promise<void> {
		this.running = false;
		this.lifecycleVersion += 1;
		if (this.pollTimer != null) clearInterval(this.pollTimer);
		this.pollTimer = null;
		this.detectedActivities = [];
		this.rpcActivities.clear();
		await this.enqueueRpc(() => this.rpcServer.stop());
		this.emit();
	}

	currentActivities(): Array<DesktopActivity> {
		return mergeActivities([...this.rpcActivities.values()], this.detectedActivities);
	}

	// A delayed socket bind must finish before its stop closes the transport.
	// This queue covers only RPC lifecycle operations, never slow process scans.
	private enqueueRpc(operation: () => Promise<void>): Promise<void> {
		const pending = this.rpcLifecycle.then(operation);
		this.rpcLifecycle = pending.catch(() => {});
		return pending;
	}

	private async loadDetectables(): Promise<Array<import('@electron/common/RpcActivityTypes').DetectableApplication>> {
		const fetchText = this.options.fetchDetectables ?? (() => readFile(this.options.detectablesPath, 'utf8'));
		try {
			const text = await fetchText();
			const payload: unknown = JSON.parse(text);
			const parsed = parseDetectables(payload);
			// Preserve usable overrides, including an intentional empty catalogue.
			if (Array.isArray(payload) && (payload.length === 0 || parsed.length > 0)) {
				return parsed;
			}
		} catch {}
		return parseDetectables(bundledDetectables);
	}

	private async refreshDetected(): Promise<void> {
		if (!this.running) return;
		const lifecycle = this.lifecycleVersion;
		const detection = ++this.detectionVersion;
		const lister = this.options.listProcesses ?? listRunningProcesses;
		let processes: Array<import('@electron/common/RpcActivityTypes').DetectedProcess> = [];
		try {
			processes = await lister();
		} catch {
			processes = [];
		}
		// Accept completed scans in request order. A slow older completion cannot
		// replace a newer result, but a pending poll need not suppress useful data.
		if (!this.running || lifecycle !== this.lifecycleVersion || detection < this.publishedDetectionVersion) return;
		this.publishedDetectionVersion = detection;
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
