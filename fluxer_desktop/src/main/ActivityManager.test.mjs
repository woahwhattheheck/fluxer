// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {describe, test} from 'node:test';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

function loadTs(relativePath) {
	const sourcePath = fileURLToPath(new URL(relativePath, import.meta.url));
	const source = readFileSync(sourcePath, 'utf8');
	const transformed = esbuild.transformSync(source, {
		loader: 'ts',
		format: 'cjs',
		platform: 'node',
		target: 'node20',
	}).code;
	const module = {exports: {}};
	const localRequire = (name) => {
		const map = {
			'@electron/main/DetectableApplications': './DetectableApplications.ts',
			'@electron/main/ActivityProcessScanner': './ActivityProcessScanner.ts',
			'@electron/main/ArRpcServer': './ArRpcServer.ts',
			'@electron/common/RpcActivityTypes': '../common/RpcActivityTypes.ts',
		};
		if (map[name] != null) return loadTs(map[name]);
		return require(name);
	};
	new Function('module', 'exports', 'require', transformed)(module, module.exports, localRequire);
	return module.exports;
}

const {mergeActivities, ActivityManager} = loadTs('./ActivityManager.ts');

function rpcActivity(name, pid) {
	return {kind: 'rpc', name, pid, type: 0};
}

function detectedActivity(name) {
	return {kind: 'detected', name, type: 0};
}

describe('mergeActivities', () => {
	test('rpc activities come first', () => {
		const merged = mergeActivities([rpcActivity('RPC Game', 1)], [detectedActivity('Other')]);
		assert.equal(merged[0].name, 'RPC Game');
		assert.equal(merged[1].name, 'Other');
	});

	test('detected activity is skipped when rpc already reports the same name', () => {
		const merged = mergeActivities([rpcActivity('Minecraft', 1)], [detectedActivity('Minecraft')]);
		assert.equal(merged.length, 1);
		assert.equal(merged[0].kind, 'rpc');
	});

	test('cap at five activities', () => {
		const merged = mergeActivities(
			[rpcActivity('a', 1), rpcActivity('b', 2)],
			[1, 2, 3, 4, 5, 6].map((n) => detectedActivity(`detected-${n}`)),
		);
		assert.equal(merged.length, 5);
	});

	test('empty inputs yield empty list', () => {
		assert.equal(mergeActivities([], []).length, 0);
	});
});

describe('ActivityManager lifecycle', () => {
	test('start emits detected activities and rpc updates override them', async () => {
		const emissions = [];
		const manager = new ActivityManager({
			detectablesPath: 'unused',
			onChange: (activities) => emissions.push(activities),
			fetchDetectables: async () =>
				JSON.stringify([
					{
						name: 'Minecraft',
						icon: 'minecraft.png',
						executables: [{name: 'minecraft.windows.exe', os: 'win32'}],
					},
				]),
			listProcesses: async () => [{name: 'minecraft.windows.exe'}],
			pollIntervalMs: 60_000,
		});
		await manager.start();
		try {
			assert.equal(emissions.length, 1);
			assert.equal(emissions[0].length, 1);
			assert.equal(emissions[0][0].name, 'Minecraft');
			assert.equal(emissions[0][0].kind, 'detected');

			// A second poll with no matching processes clears the activity.
			await new Promise((resolve) => setTimeout(resolve, 50));
		} finally {
			await manager.stop();
		}
		const finalActivities = manager.currentActivities();
		assert.equal(finalActivities.length, 0);
	});
});
