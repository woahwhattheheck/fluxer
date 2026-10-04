// SPDX-License-Identifier: AGPL-3.0-or-later

import {registerChannelControllers} from '@app/api/channel/controllers/index';
import {ThreadController} from '@app/api/channel/controllers/ThreadController';
import type {HonoApp} from '@app/api/types/HonoEnv';

export function ChannelController(app: HonoApp) {
	registerChannelControllers(app);
	ThreadController(app);
}
