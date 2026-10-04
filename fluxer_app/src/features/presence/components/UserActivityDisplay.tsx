// SPDX-License-Identifier: AGPL-3.0-or-later

import Presence from '@app/features/presence/state/Presence';
import {
	formatActivityElapsed,
	formatActivitySubtitle,
	formatActivityTitle,
	sanitizeActivities,
} from '@app/features/presence/utils/ActivityDisplayUtils';
import {observer} from 'mobx-react-lite';
import {useEffect, useState} from 'react';

import styles from './UserActivityDisplay.module.css';

interface UserActivityDisplayProps {
	userId: string;
	/** Re-render tick for elapsed timers. */
	now?: number;
}

/**
 * Renders a user's current activities (game / music / software) inside their
 * profile. Shared by desktop and mobile surfaces.
 */
export const UserActivityDisplay = observer(function UserActivityDisplay({userId}: UserActivityDisplayProps) {
	const activities = sanitizeActivities(Presence.getActivities(userId));
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (activities.length === 0) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [activities.length]);

	if (activities.length === 0) return null;

	return (
		<div className={styles.activities} data-flx="presence.user-activity-display">
			{activities.map((activity) => {
				const subtitle = formatActivitySubtitle(activity);
				const elapsed = formatActivityElapsed(activity, now);
				return (
					<div key={`${activity.name}-${activity.type}`} className={styles.activity}>
						<div className={styles.activityTitle}>{formatActivityTitle(activity)}</div>
						{subtitle != null && <div className={styles.activitySubtitle}>{subtitle}</div>}
						{elapsed != null && <div className={styles.activityElapsed}>{elapsed} elapsed</div>}
					</div>
				);
			})}
		</div>
	);
});
