// SPDX-License-Identifier: AGPL-3.0-or-later

import {app} from 'electron';
import {BrowserWindow} from 'electron';
import {ActivityManager, defaultDetectablesPath} from '@electron/main/ActivityManager';
import type {DesktopActivity} from '@electron/common/RpcActivityTypes';

/**
 * Process-wide activity manager singleton. The renderer subscribes to change
 * events over IPC and pushes the merged activity list into its gateway
 * presence updates.
 */

let manager: ActivityManager | null = null;

export function getActivityManager(): ActivityManager {
	if (manager != null) return manager;
	manager = new ActivityManager({
		detectablesPath: defaultDetectablesPath(app.getPath('userData')),
		onChange: broadcastActivities,
	});
	return manager;
}

export async function startActivityDetection(): Promise<void> {
	await getActivityManager().start();
}

export async function stopActivityDetection(): Promise<void> {
	await manager?.stop();
	manager = null;
}

function broadcastActivities(_activities: Array<DesktopActivity>): void {
	// Forwarded to every renderer window; the app filters by window interest.
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) {
			window.webContents.send('activity:updated', getActivityManager().currentActivities());
		}
	}
}
