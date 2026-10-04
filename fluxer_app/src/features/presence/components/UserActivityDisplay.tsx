// SPDX-License-Identifier: AGPL-3.0-or-later

import Authentication from '@app/features/auth/state/Authentication';
import styles from '@app/features/presence/components/UserActivityDisplay.module.css';
import LocalPresence from '@app/features/presence/state/LocalPresence';
import Presence from '@app/features/presence/state/Presence';
import {
	formatActivityElapsed,
	formatActivitySubtitle,
	formatActivityTitle,
	sanitizeActivities,
} from '@app/features/presence/utils/ActivityDisplayUtils';
import {observer} from 'mobx-react-lite';
import {useEffect, useState} from 'react';

interface UserActivityDisplayProps {
	userId: string;
	/** Re-render tick for elapsed timers. */
	now?: number;
}

/**
 * Renders a user's current activities (game / music / software) inside their
 * profile. Shared by desktop and mobile surfaces.
 */
export const UserActivityDisplay = observer(function UserActivityDisplay({userId, now}: UserActivityDisplayProps) {
	const activities = sanitizeActivities(
		userId === Authentication.currentUserId ? LocalPresence.activities : Presence.getActivities(userId),
	);
	const [currentTime, setCurrentTime] = useState(() => Date.now());
	const hasElapsedActivity = activities.some((activity) => {
		const start = activity.timestamps?.start;
		return typeof start === 'number' && Number.isFinite(start) && start > 0;
	});

	useEffect(() => {
		if (!hasElapsedActivity || now !== undefined) return;
		const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [hasElapsedActivity, now]);

	if (activities.length === 0) return null;

	return (
		<div className={styles.activities} data-flx="presence.user-activity-display">
			{activities.map((activity) => {
				const subtitle = formatActivitySubtitle(activity);
				const elapsed = formatActivityElapsed(activity, now ?? currentTime);
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
