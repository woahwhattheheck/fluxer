// SPDX-License-Identifier: AGPL-3.0-or-later

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {DetectedProcess} from '@electron/common/RpcActivityTypes';

const execFileAsync = promisify(execFile);
const PROCESS_QUERY_MAX_BUFFER_BYTES = 4 * 1024 * 1024;

/**
 * Cross-platform process enumeration for activity detection.
 *
 * Windows: PowerShell `Get-CimInstance` supplies the executable path and
 * command line (needed for shared-runtime rules such as Minecraft on
 * `javaw.exe`).
 *
 * POSIX: `ps -axo pid=,comm=,args=` gives name and full command line.
 */

function parseCsvRows(stdout: string): Array<Array<string>> {
	const rows: Array<Array<string>> = [];
	let row: Array<string> = [];
	let cell = '';
	let quoted = false;
	for (let index = 0; index < stdout.length; index++) {
		const character = stdout[index];
		if (character === '"') {
			if (quoted && stdout[index + 1] === '"') {
				cell += '"';
				index++;
			} else {
				quoted = !quoted;
			}
		} else if (!quoted && (character === ',' || character === '\r' || character === '\n')) {
			row.push(cell);
			cell = '';
			if (character !== ',') {
				rows.push(row);
				row = [];
				if (character === '\r' && stdout[index + 1] === '\n') index++;
			}
		} else {
			cell += character;
		}
	}
	if (cell || row.length > 0) {
		row.push(cell);
		rows.push(row);
	}
	return rows;
}

function parseProcessId(value: string | undefined): number | undefined {
	if (value == null || !/^\d+$/.test(value.trim())) return undefined;
	const pid = Number(value);
	return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

function parseWindowsWmicCsv(stdout: string): Array<DetectedProcess> {
	const processes: Array<DetectedProcess> = [];
	const [headerRow, ...rows] = parseCsvRows(stdout);
	if (!headerRow) return processes;
	const header = headerRow.map((cell) => cell.trim());
	const nameIndex = header.indexOf('Name');
	const commandLineIndex = header.indexOf('CommandLine');
	const executablePathIndex = header.indexOf('ExecutablePath');
	const processIdIndex = header.indexOf('ProcessId');
	if (nameIndex === -1) return processes;
	for (const cells of rows) {
		const name = cells[nameIndex]?.trim();
		if (!name) continue;
		const commandLine = commandLineIndex >= 0 ? cells[commandLineIndex]?.trim() : undefined;
		const executablePath = executablePathIndex >= 0 ? cells[executablePathIndex]?.trim() : undefined;
		const pid = parseProcessId(processIdIndex >= 0 ? cells[processIdIndex] : undefined);
		processes.push({
			name: name.toLowerCase(),
			...(pid === undefined ? {} : {pid}),
			...(commandLine ? {commandLine: commandLine.toLowerCase()} : {}),
			...(executablePath ? {executablePath} : {}),
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
				'Get-CimInstance Win32_Process | Select-Object Name,CommandLine,ExecutablePath,ProcessId | ConvertTo-Csv -NoTypeInformation',
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
		const [, processId, command, args] = match;
		if (!command) continue;
		const pid = parseProcessId(processId);
		const name = command.includes('/') ? command.slice(command.lastIndexOf('/') + 1) : command;
		const commandLine = args?.trim() ? `${command} ${args.trim()}` : command;
		processes.push({
			name: name.toLowerCase(),
			...(pid === undefined ? {} : {pid}),
			commandLine: commandLine.toLowerCase(),
			...(command.includes('/') ? {executablePath: command} : {}),
		});
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
