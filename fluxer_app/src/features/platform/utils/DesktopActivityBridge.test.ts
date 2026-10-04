// SPDX-License-Identifier: AGPL-3.0-or-later

import {beforeEach, describe, expect, test, vi} from 'vitest';

interface ElectronApiFixture {
	getCurrentActivities: () => Promise<unknown>;
	onActivitiesUpdated: (listener: (activities: unknown) => void) => () => void;
}

let electronApi: ElectronApiFixture | undefined;
const setActivities = vi.fn();

vi.mock('@app/features/presence/state/LocalPresence', () => ({default: {setActivities}}));
vi.mock('@app/features/ui/utils/NativeUtils', () => ({getElectronAPI: () => electronApi}));

const {initializeDesktopActivityBridge} = await import('@app/features/platform/utils/DesktopActivityBridge');

function createElectronFixture() {
	let resolve!: (activities: unknown) => void;
	let reject!: (error: Error) => void;
	const snapshot = new Promise<unknown>((resolveSnapshot, rejectSnapshot) => {
		resolve = resolveSnapshot;
		reject = rejectSnapshot;
	});
	let listener: ((activities: unknown) => void) | undefined;
	const unsubscribe = vi.fn();
	const getCurrentActivities = vi.fn(() => snapshot);
	const onActivitiesUpdated = vi.fn((onUpdate: (activities: unknown) => void) => {
		listener = onUpdate;
		return unsubscribe;
	});
	electronApi = {getCurrentActivities, onActivitiesUpdated};
	return {
		snapshot,
		resolve,
		reject,
		unsubscribe,
		getCurrentActivities,
		onActivitiesUpdated,
		emit: (activities: unknown) => listener?.(activities),
	};
}

beforeEach(() => {
	electronApi = undefined;
	vi.clearAllMocks();
});

describe('initializeDesktopActivityBridge', () => {
	test('returns undefined when the desktop API is unavailable', () => {
		expect(initializeDesktopActivityBridge()).toBeUndefined();
		expect(setActivities).not.toHaveBeenCalled();
	});

	test('applies the initial snapshot and preserves payload conversion for later updates', async () => {
		const fixture = createElectronFixture();
		const cleanup = initializeDesktopActivityBridge();
		const initial = [{name: 'Initial activity', type: 0}];
		fixture.resolve(initial);
		await fixture.snapshot;
		expect(setActivities).toHaveBeenCalledExactlyOnceWith(initial);
		fixture.emit({unexpected: 'payload'});
		expect(setActivities).toHaveBeenLastCalledWith(null);
		cleanup?.();
		expect(fixture.unsubscribe).toHaveBeenCalledOnce();
	});

	test('does not overwrite an event with an older initial snapshot', async () => {
		const fixture = createElectronFixture();
		const cleanup = initializeDesktopActivityBridge();
		const current = [{name: 'Current activity', type: 0}];
		fixture.emit(current);
		fixture.resolve([{name: 'Old activity', type: 0}]);
		await fixture.snapshot;
		expect(setActivities).toHaveBeenCalledExactlyOnceWith(current);
		cleanup?.();
	});

	test.each([
		{label: 'empty array', cleared: []},
		{label: 'null', cleared: null},
	])('subscribes before retrieval and retains a pushed clear: $label', async ({cleared}) => {
		const fixture = createElectronFixture();
		fixture.getCurrentActivities.mockImplementation(() => {
			fixture.emit(cleared);
			return fixture.snapshot;
		});
		const cleanup = initializeDesktopActivityBridge();
		fixture.resolve([{name: 'Old activity', type: 0}]);
		await fixture.snapshot;
		expect(setActivities).toHaveBeenCalledExactlyOnceWith(cleared);
		cleanup?.();
	});

	test('ignores a pending snapshot and queued events during and after cleanup', async () => {
		const fixture = createElectronFixture();
		fixture.unsubscribe.mockImplementation(() => fixture.emit([{name: 'During cleanup', type: 0}]));
		const cleanup = initializeDesktopActivityBridge();
		cleanup?.();
		fixture.emit([{name: 'Queued event', type: 0}]);
		fixture.resolve([{name: 'Old activity', type: 0}]);
		await fixture.snapshot;
		expect(setActivities).not.toHaveBeenCalled();
		expect(fixture.unsubscribe).toHaveBeenCalledOnce();
	});

	test('continues receiving events after the initial retrieval rejects', async () => {
		const fixture = createElectronFixture();
		const cleanup = initializeDesktopActivityBridge();
		fixture.reject(new Error('snapshot unavailable'));
		await fixture.snapshot.catch(() => {});
		const current = [{name: 'Current activity', type: 0}];
		fixture.emit(current);
		expect(setActivities).toHaveBeenCalledExactlyOnceWith(current);
		cleanup?.();
	});
});
