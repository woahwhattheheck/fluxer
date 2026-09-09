// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
	DetectableApplication,
	DetectableExecutable,
	DetectedApplicationActivity,
	DetectedProcess,
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

/** Extract the basename of a posix-style path suffix rule, e.g. `content/minecraft.exe`. */
function executableRuleBasename(rule: string): string {
	const slash = rule.lastIndexOf('/');
	return slash === -1 ? rule : rule.slice(slash + 1);
}

function isRuntimeRule(rule: string): boolean {
	return rule.startsWith(RUNTIME_PREFIX);
}

function stripRuntimePrefix(rule: string): string {
	return rule.slice(RUNTIME_PREFIX.length);
}

function matchesPathSuffix(executablePath: string, rule: string): boolean {
	if (!rule.includes('/')) {
		return executablePath === rule;
	}
	return executablePath.endsWith(`/${rule}`) || executablePath === rule;
}

function ruleMatchesProcess(rule: DetectableExecutable, process: DetectedProcess): boolean {
	const rawName = normalizeExecutableName(rule.name);
	const processName = normalizeExecutableName(process.name);
	const commandLine = process.commandLine?.toLowerCase() ?? '';

	if (isRuntimeRule(rawName)) {
		const runtimeName = stripRuntimePrefix(rawName);
		if (processName !== executableRuleBasename(runtimeName)) return false;
		if (!rule.arguments) return false;
		return commandLine.includes(rule.arguments.toLowerCase());
	}

	if (!matchesPathSuffix(processName, rawName)) {
		// The process name is a bare basename; a path-suffix rule can also
		// match when the executable name component is identical.
		if (processName !== executableRuleBasename(rawName)) return false;
	}
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
		for (const process of processes) {
			if (!applicationMatches(application, process, platform)) continue;
			matched.set(application.name, {
				kind: 'detected',
				name: application.name,
				type: 0,
				...(application.icon ? {icon: application.icon} : {}),
			});
			break;
		}
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
		});
	}
	return applications;
}
