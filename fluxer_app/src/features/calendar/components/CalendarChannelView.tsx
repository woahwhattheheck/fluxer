// SPDX-License-Identifier: AGPL-3.0-or-later

import {Endpoints} from '@app/features/app/constants/Endpoints';
import Authentication from '@app/features/auth/state/Authentication';
import * as CalendarEventCommands from '@app/features/calendar/commands/CalendarEventCommands';
import type {CalendarEventInput} from '@app/features/calendar/commands/CalendarEventCommands';
import styles from '@app/features/calendar/components/CalendarChannelView.module.css';
import Channels from '@app/features/channel/state/Channels';
import Permission from '@app/features/permissions/state/Permission';
import {Button} from '@app/features/ui/button/Button';
import {Permissions} from '@fluxer/constants/src/ChannelConstants';
import type {CalendarEventResponse} from '@fluxer/schema/src/domains/calendar/CalendarSchemas';
import {
	BellIcon,
	BellSlashIcon,
	CalendarBlankIcon,
	DownloadSimpleIcon,
	PencilSimpleIcon,
	PlusIcon,
	TrashIcon,
} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback, useEffect, useMemo, useState} from 'react';

interface CalendarChannelViewProps {
	guildId: string;
	channelId: string;
}

interface EventDraft {
	name: string;
	description: string;
	startsAt: string;
	endsAt: string;
	recurrenceFrequency: '' | 'daily' | 'weekly' | 'monthly';
	recurrenceInterval: string;
	externalLocation: string;
}

function toLocalDateTimeInput(date: Date): string {
	const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
	return local.toISOString().slice(0, 16);
}

function defaultDraft(): EventDraft {
	const starts = new Date(Date.now() + 30 * 60_000);
	starts.setSeconds(0, 0);
	const ends = new Date(starts.getTime() + 60 * 60_000);
	return {
		name: '',
		description: '',
		startsAt: toLocalDateTimeInput(starts),
		endsAt: toLocalDateTimeInput(ends),
		recurrenceFrequency: '',
		recurrenceInterval: '1',
		externalLocation: '',
	};
}

function eventToDraft(event: CalendarEventResponse): EventDraft {
	return {
		name: event.name,
		description: event.description ?? '',
		startsAt: toLocalDateTimeInput(new Date(event.starts_at)),
		endsAt: toLocalDateTimeInput(new Date(event.ends_at)),
		recurrenceFrequency: event.recurrence_frequency ?? '',
		recurrenceInterval: String(event.recurrence_interval ?? 1),
		externalLocation: event.external_location ?? '',
	};
}

function sortEvents(events: Array<CalendarEventResponse>): Array<CalendarEventResponse> {
	return [...events].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
}

function formatRange(event: CalendarEventResponse): string {
	const start = new Date(event.starts_at);
	const end = new Date(event.ends_at);
	const date = new Intl.DateTimeFormat(undefined, {weekday: 'short', month: 'short', day: 'numeric'}).format(start);
	const times = new Intl.DateTimeFormat(undefined, {hour: 'numeric', minute: '2-digit'});
	return `${date} · ${times.format(start)}–${times.format(end)}`;
}

function recurrenceLabel(event: CalendarEventResponse): string | null {
	if (!event.recurrence_frequency) return null;
	const interval = event.recurrence_interval ?? 1;
	if (interval === 1) return `Repeats ${event.recurrence_frequency}`;
	return `Repeats every ${interval} ${event.recurrence_frequency} intervals`;
}

export const CalendarChannelView: React.FC<CalendarChannelViewProps> = observer(({guildId, channelId}) => {
	const channel = Channels.getChannel(channelId);
	const currentUserId = Authentication.currentUserId;
	const canCreate = Permission.can(Permissions.CREATE_EVENTS, {guildId, channelId});
	const canManage = Permission.can(Permissions.MANAGE_EVENTS, {guildId, channelId});
	const [events, setEvents] = useState<Array<CalendarEventResponse>>([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [showForm, setShowForm] = useState(false);
	const [editingEventId, setEditingEventId] = useState<string | null>(null);
	const [draft, setDraft] = useState<EventDraft>(() => defaultDraft());

	const loadEvents = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			setEvents(sortEvents(await CalendarEventCommands.listGuildEvents(guildId)));
		} catch (loadError) {
			setError(loadError instanceof Error ? loadError.message : 'Unable to load calendar events.');
		} finally {
			setLoading(false);
		}
	}, [guildId]);

	useEffect(() => {
		void loadEvents();
	}, [loadEvents]);

	const resetForm = useCallback(() => {
		setEditingEventId(null);
		setDraft(defaultDraft());
		setShowForm(false);
	}, []);

	const beginCreate = useCallback(() => {
		setEditingEventId(null);
		setDraft(defaultDraft());
		setShowForm(true);
	}, []);

	const beginEdit = useCallback((event: CalendarEventResponse) => {
		setEditingEventId(event.id);
		setDraft(eventToDraft(event));
		setShowForm(true);
	}, []);

	const buildPayload = useCallback((): CalendarEventInput => {
		const interval = Number.parseInt(draft.recurrenceInterval, 10);
		return {
			name: draft.name.trim(),
			description: draft.description.trim() || null,
			starts_at: new Date(draft.startsAt).toISOString(),
			ends_at: new Date(draft.endsAt).toISOString(),
			recurrence_frequency: draft.recurrenceFrequency || null,
			recurrence_interval: draft.recurrenceFrequency ? (Number.isFinite(interval) && interval > 0 ? interval : 1) : null,
			external_location: draft.externalLocation.trim() || null,
		};
	}, [draft]);

	const handleSubmit = useCallback(
		async (event: React.FormEvent) => {
			event.preventDefault();
			if (!draft.name.trim()) {
				setError('Event name is required.');
				return;
			}
			const startsAt = new Date(draft.startsAt);
			const endsAt = new Date(draft.endsAt);
			if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
				setError('End time must be after start time.');
				return;
			}
			setSaving(true);
			setError(null);
			try {
				const saved = editingEventId
					? await CalendarEventCommands.updateEvent(guildId, editingEventId, buildPayload())
					: await CalendarEventCommands.createEvent(guildId, buildPayload());
				setEvents((current) => sortEvents([...current.filter((item) => item.id !== saved.id), saved]));
				resetForm();
			} catch (saveError) {
				setError(saveError instanceof Error ? saveError.message : 'Unable to save event.');
			} finally {
				setSaving(false);
			}
		},
		[buildPayload, draft, editingEventId, guildId, resetForm],
	);

	const handleToggleSubscription = useCallback(
		async (event: CalendarEventResponse) => {
			setError(null);
			try {
				const updated = event.subscribed
					? await CalendarEventCommands.unsubscribe(guildId, event.id)
					: await CalendarEventCommands.subscribe(guildId, event.id);
				setEvents((current) => current.map((item) => (item.id === updated.id ? updated : item)));
			} catch (subscriptionError) {
				setError(subscriptionError instanceof Error ? subscriptionError.message : 'Unable to update event subscription.');
			}
		},
		[guildId],
	);

	const handleDelete = useCallback(
		async (event: CalendarEventResponse) => {
			if (!window.confirm(`Delete “${event.name}”?`)) return;
			setError(null);
			try {
				await CalendarEventCommands.deleteEvent(guildId, event.id);
				setEvents((current) => current.filter((item) => item.id !== event.id));
				if (editingEventId === event.id) resetForm();
			} catch (deleteError) {
				setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete event.');
			}
		},
		[editingEventId, guildId, resetForm],
	);

	const title = useMemo(() => channel?.name ?? 'Calendar', [channel?.name]);

	return (
		<div className={styles.root} data-flx="calendar.calendar-channel-view.root">
			<header className={styles.toolbar} data-flx="calendar.calendar-channel-view.toolbar">
				<div className={styles.titleGroup}>
					<CalendarBlankIcon size={20} aria-hidden="true" />
					<h1 className={styles.title}>{title}</h1>
				</div>
				<div className={styles.actions}>
					<Button
						small
						variant="secondary"
						leftIcon={<DownloadSimpleIcon size={16} aria-hidden="true" />}
						onClick={() => window.location.assign(Endpoints.USER_CALENDAR_EXPORT)}
					>
						Export my calendar
					</Button>
					{canCreate && (
						<Button small leftIcon={<PlusIcon size={16} aria-hidden="true" />} onClick={beginCreate}>
							New event
						</Button>
					)}
				</div>
			</header>
			<div className={styles.scroll}>
				{error && <p className={styles.error}>{error}</p>}
				{showForm && canCreate && (
					<form className={styles.form} onSubmit={handleSubmit}>
						<div className={styles.formGrid}>
							<label className={styles.field}>
								Event name
								<input
									className={styles.input}
									value={draft.name}
									maxLength={100}
									required
									onChange={(event) => setDraft((current) => ({...current, name: event.target.value}))}
								/>
							</label>
							<label className={styles.field}>
								Location
								<input
									className={styles.input}
									value={draft.externalLocation}
									maxLength={300}
									onChange={(event) => setDraft((current) => ({...current, externalLocation: event.target.value}))}
								/>
							</label>
							<label className={styles.field}>
								Starts
								<input
									type="datetime-local"
									className={styles.input}
									value={draft.startsAt}
									required
									onChange={(event) => setDraft((current) => ({...current, startsAt: event.target.value}))}
								/>
							</label>
							<label className={styles.field}>
								Ends
								<input
									type="datetime-local"
									className={styles.input}
									value={draft.endsAt}
									required
									onChange={(event) => setDraft((current) => ({...current, endsAt: event.target.value}))}
								/>
							</label>
							<label className={styles.field}>
								Repeats
								<select
									className={styles.select}
									value={draft.recurrenceFrequency}
									onChange={(event) =>
										setDraft((current) => ({
											...current,
											recurrenceFrequency: event.target.value as EventDraft['recurrenceFrequency'],
										}))
									}
								>
									<option value="">Does not repeat</option>
									<option value="daily">Daily</option>
									<option value="weekly">Weekly</option>
									<option value="monthly">Monthly</option>
								</select>
							</label>
							<label className={styles.field}>
								Repeat interval
								<input
									type="number"
									min={1}
									max={52}
									className={styles.input}
									disabled={!draft.recurrenceFrequency}
									value={draft.recurrenceInterval}
									onChange={(event) => setDraft((current) => ({...current, recurrenceInterval: event.target.value}))}
								/>
							</label>
							<label className={`${styles.field} ${styles.fieldWide}`}>
								Description
								<textarea
									className={styles.textarea}
									value={draft.description}
									maxLength={4000}
									onChange={(event) => setDraft((current) => ({...current, description: event.target.value}))}
								/>
							</label>
						</div>
						<div className={styles.formActions}>
							<Button type="button" variant="secondary" small onClick={resetForm}>
								Cancel
							</Button>
							<Button type="submit" small submitting={saving}>
								{editingEventId ? 'Save event' : 'Create event'}
							</Button>
						</div>
					</form>
				)}
				{loading ? (
					<div className={styles.empty}>Loading events…</div>
				) : events.length === 0 ? (
					<div className={styles.empty}>No events scheduled yet.</div>
				) : (
					<div className={styles.events}>
						{events.map((event) => {
							const canEditEvent = canManage || (currentUserId != null && event.creator_id === currentUserId);
							const recurrence = recurrenceLabel(event);
							return (
								<article className={styles.eventCard} key={event.id}>
									<div className={styles.eventHeader}>
										<h2 className={styles.eventName}>{event.name}</h2>
										<span className={styles.eventMeta}>{event.subscription_count} subscribed</span>
									</div>
									<p className={styles.eventTime}>{formatRange(event)}</p>
									{event.description && <p className={styles.description}>{event.description}</p>}
									{event.external_location && <p className={styles.eventMeta}>Location: {event.external_location}</p>}
									{recurrence && <p className={styles.eventMeta}>{recurrence}</p>}
									<div className={styles.eventActions}>
										<Button
											small
											variant={event.subscribed ? 'secondary' : 'primary'}
											leftIcon={
												event.subscribed ? (
													<BellSlashIcon size={15} aria-hidden="true" />
												) : (
													<BellIcon size={15} aria-hidden="true" />
												)
											}
											onClick={() => void handleToggleSubscription(event)}
										>
											{event.subscribed ? 'Unsubscribe' : 'Subscribe'}
										</Button>
										{canEditEvent && canCreate && (
											<Button
												small
												variant="secondary"
												leftIcon={<PencilSimpleIcon size={15} aria-hidden="true" />}
												onClick={() => beginEdit(event)}
											>
												Edit
											</Button>
										)}
										{canEditEvent && canCreate && (
											<Button
												small
												variant="danger"
												leftIcon={<TrashIcon size={15} aria-hidden="true" />}
												onClick={() => void handleDelete(event)}
											>
												Delete
											</Button>
										)}
									</div>
								</article>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
});
