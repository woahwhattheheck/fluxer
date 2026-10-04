// SPDX-License-Identifier: AGPL-3.0-or-later

import * as Modal from '@app/features/app/components/dialogs/Modal';
import * as ThreadCommands from '@app/features/channel/commands/ThreadCommands';
import {selectChannel} from '@app/features/navigation/commands/NavigationCommands';
import {HttpError} from '@app/features/platform/types/EndpointError';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {Form} from '@app/features/ui/components/form/Form';
import {Input} from '@app/features/ui/components/form/FormInput';
import * as FormUtils from '@app/lib/forms';
import {msg} from '@lingui/core/macro';
import {Trans, useLingui} from '@lingui/react/macro';
import {observer} from 'mobx-react-lite';
import {useForm} from 'react-hook-form';

const START_THREAD_DESCRIPTOR = msg({
	message: 'Start new thread',
	comment: 'Title and primary action for the public thread creation modal.',
});
const THREAD_NAME_DESCRIPTOR = msg({
	message: 'Thread name',
	comment: 'Label for the public thread name field.',
});

interface FormInputs {
	name: string;
}

export const ThreadCreateModal = observer(
	({parentChannelId, guildId}: {parentChannelId: string; guildId: string}) => {
		const {i18n} = useLingui();
		const form = useForm<FormInputs>();
		const handleSubmit = async (data: FormInputs) => {
			try {
				const thread = await ThreadCommands.createPublicThread(parentChannelId, data.name.trim());
				ModalCommands.pop();
				selectChannel(guildId, thread.id);
			} catch (error) {
				if (error instanceof HttpError) {
					FormUtils.handleError(i18n, form, error, 'name');
				} else {
					form.setError('name', {type: 'server', message: FormUtils.extractErrorMessage(i18n, error)});
				}
			}
		};

		return (
			<Modal.Root size="small" centered data-flx="channel.thread-create-modal.modal-root">
				<Form
					form={form}
					onSubmit={handleSubmit}
					aria-label={i18n._(START_THREAD_DESCRIPTOR)}
					data-flx="channel.thread-create-modal.form.submit"
				>
					<Modal.Header title={i18n._(START_THREAD_DESCRIPTOR)} data-flx="channel.thread-create-modal.modal-header" />
					<Modal.Content data-flx="channel.thread-create-modal.modal-content">
						<Modal.ContentLayout data-flx="channel.thread-create-modal.modal-content-layout">
							<Input
								data-flx="channel.thread-create-modal.input.name"
								{...form.register('name', {
									setValueAs: (value) => (typeof value === 'string' ? value.trim() : value),
								})}
								autoComplete="off"
								autoFocus={true}
								error={form.formState.errors.name?.message}
								label={i18n._(THREAD_NAME_DESCRIPTOR)}
								maxLength={100}
								minLength={1}
								required={true}
								type="text"
							/>
						</Modal.ContentLayout>
					</Modal.Content>
					<Modal.Footer data-flx="channel.thread-create-modal.modal-footer">
						<Button onClick={ModalCommands.pop} variant="secondary" data-flx="channel.thread-create-modal.button.cancel">
							<Trans>Cancel</Trans>
						</Button>
						<Button type="submit" submitting={form.formState.isSubmitting} data-flx="channel.thread-create-modal.button.submit">
							<Trans>Start thread</Trans>
						</Button>
					</Modal.Footer>
				</Form>
			</Modal.Root>
		);
	},
);
