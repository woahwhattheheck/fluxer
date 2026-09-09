// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Activity kinds reported by detection sources. Mirrors the gateway presence
 * activity `type` field so the renderer can forward payloads verbatim.
 */
export const ActivityTypes = {
	PLAYING: 0,
	LISTENING: 2,
	WATCHING: 3,
	COMPETING: 5,
} as const;

export type ActivityTypeValue = (typeof ActivityTypes)[keyof typeof ActivityTypes];

/** A process observation handed to the detectables matcher. */
export interface DetectedProcess {
	/** Lowercased executable name, e.g. `minecraft.windows.exe`. */
	readonly name: string;
	/** Full command line when available, used for `>` runtime rules. */
	readonly commandLine?: string;
}

/** One entry of `fluxerapp/detectables` `data/detectables.json`. */
export interface DetectableApplication {
	readonly name: string;
	readonly aliases?: Array<string>;
	readonly icon: string;
	readonly executables: Array<DetectableExecutable>;
	readonly presence_assets?: Record<string, string>;
}

export interface DetectableExecutable {
	readonly name: string;
	readonly os: 'win32' | 'linux' | 'darwin';
	readonly arguments?: string;
}

/** The activity a matched detectable produces. */
export interface DetectedApplicationActivity {
	readonly kind: 'detected';
	readonly name: string;
	readonly type: ActivityTypeValue;
	readonly icon?: string;
}

/** Activity pushed by a game via the Discord-compatible local IPC. */
export interface RpcActivity {
	readonly kind: 'rpc';
	readonly pid: number;
	readonly name: string;
	readonly type: number;
	readonly state?: string | null;
	readonly details?: string | null;
	readonly assets?: {
		readonly large_image?: string | null;
		readonly large_text?: string | null;
		readonly small_image?: string | null;
		readonly small_text?: string | null;
	} | null;
	readonly timestamps?: {
		readonly start?: number | null;
		readonly end?: number | null;
	} | null;
}

/** Union activity state the desktop exposes to the renderer. */
export type DesktopActivity = DetectedApplicationActivity | RpcActivity;
