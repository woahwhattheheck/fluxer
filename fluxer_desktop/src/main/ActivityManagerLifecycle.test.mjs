// SPDX-License-Identifier: AGPL-3.0-or-later

// Focused component check: node --test src/main/ActivityManagerLifecycle.test.mjs
// Execute the actual manager and matcher with controlled RPC lifecycle/process
// inputs. This does not exercise native sockets, Electron or an operating-system scan.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function loadTs(relativePath, dependencies = {}) {
	const filename = fileURLToPath(new URL(relativePath, import.meta.url));
	const {outputText} = ts.transpileModule(readFileSync(filename, 'utf8'), {
		fileName: filename,
		compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
	});
	const module = {exports: {}};
	const localRequire = (name) => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name);
	new Function('module', 'exports', 'require', outputText)(module, module.exports, localRequire);
	return module.exports;
}

function deferred() {
	let resolve;
	const promise = new Promise((release) => { resolve = release; });
	return {promise, resolve};
}

function catalogue(...names) {
	return JSON.stringify(names.map((name) => ({
		name, icon: `${name}.png`, executables: [{name: name.toLowerCase(), os: process.platform}],
	})));
}

function createManager(t, options = {}, hooks = {}) {
	class ControlledRpcServer {
		constructor(events) { this.events = events; this.open = false; this.calls = []; }
		async start() {
			this.calls.push('start');
			await hooks.start?.();
			this.open = true;
			this.calls.push('started');
		}
		async stop() { this.calls.push('stop'); this.open = false; }
	}
	const {ActivityManager} = loadTs('./ActivityManager.ts', {
		'@electron/main/DetectableApplications': loadTs('./DetectableApplications.ts'),
		'@electron/main/ActivityProcessScanner': {listRunningProcesses: () => { throw new Error('unexpected native scan'); }},
		'@electron/main/ArRpcServer': {ArRpcServer: ControlledRpcServer},
		'@electron/main/BundledDetectables': {bundledDetectables: []},
	});
	const manager = new ActivityManager({
		detectablesPath: 'unused', onChange: () => {}, pollIntervalMs: 60_000,
		fetchDetectables: async () => catalogue('Old', 'New'), listProcesses: async () => [], ...options,
	});
	t.after(() => manager.stop());
	return manager;
}

// TypeScript-private methods remain callable in emitted JavaScript. Calling the
// actual scan method here controls completion order without real timer delays.
test('a slow older scan cannot replace a newer completed detection', async (t) => {
	const oldScan = deferred();
	const newScan = deferred();
	let calls = 0;
	const manager = createManager(t, {listProcesses: () => [Promise.resolve([]), oldScan.promise, newScan.promise][calls++]});
	await manager.start();
	const older = manager.refreshDetected();
	const newer = manager.refreshDetected();
	newScan.resolve([{name: 'new'}]);
	await newer;
	oldScan.resolve([{name: 'old'}]);
	await older;
	assert.deepEqual(manager.detectedActivities.map(({name}) => name), ['New']);
	assert.deepEqual(manager.currentActivities(), []);
});

test('stop retires a pending initial scan, its poll timer and late RPC events', async (t) => {
	const entered = deferred();
	const scan = deferred();
	const manager = createManager(t, {listProcesses: () => { entered.resolve(); return scan.promise; }});
	const starting = manager.start();
	await entered.promise;
	await manager.stop();
	scan.resolve([{name: 'old'}]);
	await starting;
	assert.deepEqual(manager.currentActivities(), []);
	assert.equal(manager.pollTimer, null);
	manager.rpcServer.events.onActivity({kind: 'rpc', name: 'Late', pid: 1, type: 0}, 1);
	assert.deepEqual(manager.currentActivities(), []);
});

test('an old catalogue load cannot overwrite a restarted manager or arm a second timer', async (t) => {
	const oldCatalogue = deferred();
	let fetches = 0;
	const manager = createManager(t, {
		fetchDetectables: () => ++fetches === 1 ? oldCatalogue.promise : Promise.resolve(catalogue('New')),
		listProcesses: async () => [{name: 'old'}, {name: 'new'}],
	});
	const oldStart = manager.start();
	await manager.stop();
	await manager.start();
	const timer = manager.pollTimer;
	t.after(() => clearInterval(timer));
	oldCatalogue.resolve(catalogue('Old'));
	await oldStart;
	assert.deepEqual(manager.detectables.map(({name}) => name), ['New']);
	assert.deepEqual(manager.currentActivities(), []);
	assert.equal(manager.pollTimer, timer);
});

test('stop closes a delayed RPC start instead of leaving a transport open', async (t) => {
	const entered = deferred();
	const bound = deferred();
	const manager = createManager(t, {}, {start: () => { entered.resolve(); return bound.promise; }});
	const starting = manager.start();
	await entered.promise;
	const stopping = manager.stop();
	bound.resolve();
	await Promise.all([starting, stopping]);
	assert.equal(manager.rpcServer.open, false);
	assert.deepEqual(manager.rpcServer.calls, ['start', 'started', 'stop']);
	assert.equal(manager.pollTimer, null);
});
