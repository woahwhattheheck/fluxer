// SPDX-FileCopyrightText: 2026 Fluxer
// SPDX-License-Identifier: CC0-1.0

// Factual mappings from fluxerapp/detectables; no image assets are bundled.
// Source: https://github.com/fluxerapp/detectables/blob/ac1738dcde92eca5df0c6343cf0b8d1ab9cb13b2/data/detectables.json
// Source Git blob: a32b5e337881c1b7ec3c8f8dfaa2dae1c0cb28d2
// Product names identify matched software and do not imply endorsement.

export const bundledDetectables: unknown = [
	{
		name: 'Minecraft',
		aliases: ['Minecraft Launcher', 'Minecraft Windows 10 Edition', 'Minecraft: Java Edition'],
		icon: 'minecraft.png',
		executables: [
			{
				name: 'minecraft.windows.exe',
				os: 'win32',
			},
			{
				name: 'content/minecraft.exe',
				os: 'win32',
			},
			{
				name: '>javaw.exe',
				os: 'win32',
				arguments: 'net.minecraft.client.main.Main',
			},
			{
				name: '>java',
				os: 'darwin',
				arguments: 'net.minecraft.client.main.Main',
			},
			{
				name: '>java',
				os: 'linux',
				arguments: 'net.minecraft.client.main.Main',
			},
		],
	},
	{
		name: 'osu!',
		aliases: ['osu!(lazer)', 'osu!(stable)'],
		icon: 'osu.png',
		executables: [
			{
				name: 'osu!.exe',
				os: 'win32',
			},
			{
				name: 'osu!.app',
				os: 'darwin',
			},
			{
				name: 'osu!',
				os: 'linux',
			},
		],
		presence_assets: {
			mode_custom: 'osu/mode_custom.png',
			mode_2: 'osu/mode_2.png',
			mode_0: 'osu/mode_0.png',
			mode_3: 'osu/mode_3.png',
			mode_1: 'osu/mode_1.png',
			osu_logo_lazer: 'osu/osu_logo_lazer.png',
		},
	},
];
