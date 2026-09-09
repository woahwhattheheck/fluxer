// SPDX-License-Identifier: AGPL-3.0-or-later

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {DetectedProcess} from '@electron/common/RpcActivityTypes';

const execFileAsync = promisify(execFile);
const PROCESS_QUERY_MAX_BUFFER_BYTES = 4 * 1024 * 1024;

/**
 * Cross-platform process enumeration for activity detection.
 *
 * Windows: `wmic process get Name,CommandLine,ProcessId` (command line needed
 * for shared-runtime rules such as Minecraft on `javaw.exe`). wmic is
 * deprecated but present on every supported Windows release; PowerShell
 * `Get-CimInstance` is the fallback when wmic is absent.
 *
 * POSIX: `ps -axo pid=,comm=,args=` gives name and full command line.
 */

function parseWindowsWmicCsv(stdout: string): Array<DetectedProcess> {
	const processes: Array<DetectedProcess> = [];
	const lines = stdout.split(/\r?\n/);
	if (lines.length === 0) return processes;
	// wmic renders CSV cells padded with spaces around every value.
	const clean = (value: string | undefined): string => (value ?? '').trim().replace(/^"|"$/g, '');
	const header = lines[0].split(',').map((cell) => clean(cell));
	const nameIndex = header.indexOf('Name');
	const commandLineIndex = header.indexOf('CommandLine');
	const pidIndex = header.indexOf('ProcessId');
	if (nameIndex === -1) return processes;
	for (const line of lines.slice(1)) {
		if (!line.trim()) continue;
		// wmic never quotes commas inside CSV cells, so split conservatively:
		// cells are fixed by header order; command line is the remainder join.
		const cells = line.split(',').map(clean);
		const name = cells[nameIndex];
		if (!name) continue;
		const commandLine = commandLineIndex >= 0 ? cells.slice(commandLineIndex).join(',') : undefined;
		const pid = pidIndex >= 0 ? Number.parseInt(cells[pidIndex] ?? '', 10) : Number.NaN;
		processes.push({
			name: name.toLowerCase(),
			...(commandLine ? {commandLine: commandLine.toLowerCase()} : {}),
			...(Number.isFinite(pid) ? {} : {}),
		});
	}
	return processes;
}

async function getWindowsProcesses(): Promise<Array<DetectedProcess>> {
	try {
		const {stdout} = await execFileAsync(
			'powershell.exe',
			[
				'-NoProfile',
				'-NonInteractive',
				'-Command',
				'Get-CimInstance Win32_Process | Select-Object Name,CommandLine,ProcessId | ConvertTo-Csv -NoTypeInformation',
			],
			{windowsHide: true, maxBuffer: PROCESS_QUERY_MAX_BUFFER_BYTES},
		);
		return parseWindowsWmicCsv(stdout);
	} catch {
		return [];
	}
}

function parsePosixPs(stdout: string): Array<DetectedProcess> {
	const processes: Array<DetectedProcess> = [];
	for (const line of stdout.split(/\r?\n/)) {
		const match = line.match(/^\s*(\d+)\s+(\S+)\s*(.*)$/);
		if (!match) continue;
		const [, , command, args] = match;
		if (!command) continue;
		const name = command.includes('/') ? command.slice(command.lastIndexOf('/') + 1) : command;
		const commandLine = args?.trim() ? `${command} ${args.trim()}` : command;
		processes.push({name: name.toLowerCase(), commandLine: commandLine.toLowerCase()});
	}
	return processes;
}

async function getPosixProcesses(): Promise<Array<DetectedProcess>> {
	try {
		const {stdout} = await execFileAsync('ps', ['-axo', 'pid=,comm=,args='], {
			maxBuffer: PROCESS_QUERY_MAX_BUFFER_BYTES,
		});
		return parsePosixPs(stdout);
	} catch {
		return [];
	}
}

export async function listRunningProcesses(): Promise<Array<DetectedProcess>> {
	return process.platform === 'win32' ? getWindowsProcesses() : getPosixProcesses();
}

export const __internals = {parseWindowsWmicCsv, parsePosixPs};
