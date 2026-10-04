// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	isDeclaredActivityType,
	type DetectableApplication,
	type DetectableExecutable,
	type DetectedApplicationActivity,
	type DetectedProcess,
} from '@electron/common/RpcActivityTypes';

/**
 * Pure matching engine for `fluxerapp/detectables` entries.
 *
 * Rules from `schema/detectables.schema.json`:
 * - `name` is a lowercase executable name or a forward-slash path suffix.
 * - A leading `>` marks a shared runtime (e.g. `javaw.exe`): the rule only
 *   matches when `arguments` is a substring of the process command line.
 * - Any executable rule may match; rules are filtered by `os` first.
 */

const RUNTIME_PREFIX = '>';

export function normalizeExecutableName(value: string): string {
	return value.trim().toLowerCase();
}

function isRuntimeRule(rule: string): boolean {
	return rule.startsWith(RUNTIME_PREFIX);
}

function stripRuntimePrefix(rule: string): string {
	return rule.slice(RUNTIME_PREFIX.length);
}

function matchesPathSuffix(executablePath: string, rule: string): boolean {
	return executablePath.endsWith(`/${rule}`) || executablePath === rule;
}

function ruleMatchesProcess(rule: DetectableExecutable, process: DetectedProcess): boolean {
	const rawName = normalizeExecutableName(rule.name);
	const processName = normalizeExecutableName(process.name);
	const commandLine = process.commandLine?.toLowerCase() ?? '';
	const runtimeRule = isRuntimeRule(rawName);
	const executableName = runtimeRule ? stripRuntimePrefix(rawName) : rawName;

	if (executableName.includes('/')) {
		const executablePath = normalizeExecutableName(process.executablePath ?? '');
		const normalizedPath = rule.os === 'win32' ? executablePath.replaceAll('\\', '/') : executablePath;
		if (!matchesPathSuffix(normalizedPath, executableName)) return false;
	} else if (processName !== executableName) {
		return false;
	}

	if (runtimeRule && !rule.arguments) return false;
	if (rule.arguments && !commandLine.includes(rule.arguments.toLowerCase())) return false;
	return true;
}

function applicationMatches(
	application: DetectableApplication,
	process: DetectedProcess,
	platform: NodeJS.Platform,
): boolean {
	for (const rule of application.executables) {
		if (rule.os !== platform) continue;
		if (ruleMatchesProcess(rule, process)) return true;
	}
	return false;
}

/**
 * Resolve the set of detected applications for a process snapshot.
 * Later entries win so the data file can override earlier generic rules.
 */
export function matchDetectableApplications(
	applications: Array<DetectableApplication>,
	processes: Array<DetectedProcess>,
	platform: NodeJS.Platform,
): Array<DetectedApplicationActivity> {
	const matched = new Map<string, DetectedApplicationActivity>();
	for (const application of applications) {
		const processIds = new Set(matched.get(application.name)?.processIds ?? []);
		let hasMatch = false;
		for (const process of processes) {
			if (!applicationMatches(application, process, platform)) continue;
			hasMatch = true;
			if (typeof process.pid === 'number' && Number.isSafeInteger(process.pid) && process.pid > 0) {
				processIds.add(process.pid);
			}
		}
		if (!hasMatch) continue;
		const type = isDeclaredActivityType(application.type) ? application.type : undefined;
		matched.set(application.name, {
			kind: 'detected',
			name: application.name,
			...(type === undefined ? {} : {type}),
			...(application.icon ? {icon: application.icon} : {}),
			...(processIds.size > 0 ? {processIds: [...processIds]} : {}),
		});
	}
	return [...matched.values()];
}

/** Parse and validate a raw `detectables.json` payload. Invalid entries are dropped. */
export function parseDetectables(payload: unknown): Array<DetectableApplication> {
	if (!Array.isArray(payload)) return [];
	const applications: Array<DetectableApplication> = [];
	for (const entry of payload) {
		if (typeof entry !== 'object' || entry == null) continue;
		const candidate = entry as Partial<DetectableApplication>;
		if (typeof candidate.name !== 'string' || candidate.name.length === 0) continue;
		if (typeof candidate.icon !== 'string' || candidate.icon.length === 0) continue;
		if (!Array.isArray(candidate.executables) || candidate.executables.length === 0) continue;
		const executables: Array<DetectableExecutable> = [];
		for (const rule of candidate.executables) {
			if (typeof rule?.name !== 'string' || rule.name.length === 0) continue;
			if (rule.os !== 'win32' && rule.os !== 'linux' && rule.os !== 'darwin') continue;
			executables.push({
				name: rule.name,
				os: rule.os,
				...(typeof rule.arguments === 'string' && rule.arguments.length > 0
					? {arguments: rule.arguments}
					: {}),
			});
		}
		if (executables.length === 0) continue;
		applications.push({
			name: candidate.name,
			icon: candidate.icon,
			executables,
			...(Array.isArray(candidate.aliases) ? {aliases: candidate.aliases} : {}),
			...(candidate.presence_assets ? {presence_assets: candidate.presence_assets} : {}),
			...(isDeclaredActivityType(candidate.type) ? {type: candidate.type} : {}),
		});
	}
	return applications;
}
