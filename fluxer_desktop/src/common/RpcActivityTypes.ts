// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Activity kinds reported by detection sources. Mirrors the gateway presence
 * activity `type` field so the renderer can forward payloads verbatim.
 * Integers 0 through 5 are the types already declared by the shared schema.
 */
export const ActivityTypes = {
	PLAYING: 0,
	LISTENING: 2,
	WATCHING: 3,
	COMPETING: 5,
} as const;

export type ActivityTypeValue = 0 | 1 | 2 | 3 | 4 | 5;

export function isDeclaredActivityType(value: unknown): value is ActivityTypeValue {
	return value === 0 || value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

/** A process observation handed to the detectables matcher. */
export interface DetectedProcess {
	/** Actual process ID, when present in the operating-system observation. */
	readonly pid?: number;
	/** Lowercased executable name, e.g. `minecraft.windows.exe`. */
	readonly name: string;
	/** Executable path when available, used only for path-suffix detection rules. */
	readonly executablePath?: string;
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
	/** Copied from the catalogue when already present; never assigned by matching. */
	readonly type?: ActivityTypeValue;
}

export interface DetectableExecutable {
	readonly name: string;
	readonly os: 'win32' | 'linux' | 'darwin';
	readonly arguments?: string;
}

/** A catalogue match. Type is present only when the catalogue already had one. */
export interface DetectedApplicationActivity {
	readonly kind: 'detected';
	readonly name: string;
	readonly type?: ActivityTypeValue;
	readonly icon?: string;
	/** Local merge metadata; removed before activities leave ActivityManager. */
	readonly processIds?: Array<number>;
}

/** Activity pushed by a game via the Discord-compatible local IPC. */
export interface RpcActivity {
	readonly kind: 'rpc';
	readonly pid: number;
	readonly name: string;
	readonly type?: number;
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
