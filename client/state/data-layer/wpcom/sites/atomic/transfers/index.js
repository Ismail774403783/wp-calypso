/** @format */

/**
 * External dependencies
 */
import { translate } from 'i18n-calypso';

/**
 * Internal dependencies
 */
import { ATOMIC_TRANSFER_INITIATE, ATOMIC_TRANSFER_REQUEST } from 'state/action-types';
import { recordTracksEvent } from 'state/analytics/actions';
import { dispatchRequestEx } from 'state/data-layer/wpcom-http/utils';
import { requestSite } from 'state/sites/actions';
import { http } from 'state/data-layer/wpcom-http/actions';
import {
	fetchAtomicTransfer,
	setAtomicTransfer,
	atomicTransferComplete,
} from 'state/atomic-transfer/actions';
import transferStates from 'state/atomic-transfer/constants';
import { registerHandlers } from 'state/data-layer/handler-registry';
import { pluginUploadError, updatePluginUploadProgress } from 'state/plugins/upload/actions';
import { errorNotice } from 'state/notices/actions';

/**
 * Initiates a site transfer to Atomic.
 *
 * @param {?Object} action default action to call on HTTP events
 * @returns {Object} action object
 */
export const initiateTransfer = action => {
	const { siteId, module } = action;

	return [
		recordTracksEvent( 'calypso_atomic_transfer_inititate_transfer', {
			context: module[ 0 ],
		} ),
		http(
			{
				apiNamespace: 'wpcom/v2',
				body: {},
				formData: [ module ],
				method: 'POST',
				path: `/sites/${ siteId }/atomic/transfers`,
			},
			action
		),
	];
};

/**
 * Retreives the latest Atomic transfer record.
 *
 * @param {?Object} action default action to call on HTTP events
 * @returns {Object} action object
 */
export const getTransfer = action =>
	http(
		{
			apiNamespace: 'wpcom/v2',
			method: 'GET',
			path: `/sites/${ action.siteId }/atomic/transfers/latest`,
		},
		action
	);

const showErrorNotice = error => {
	if ( error.error === 'invalid_input' ) {
		return errorNotice( translate( 'The uploaded file is not a valid zip.' ) );
	}

	if ( error.error === 'api_success_false' ) {
		return errorNotice( translate( 'The uploaded file is not a valid plugin or theme.' ) );
	}

	if ( error.error ) {
		return errorNotice(
			translate( 'Upload problem: %(error)s.', {
				args: { error: error.error },
			} )
		);
	}
	return errorNotice( translate( 'Problem uploading the plugin or theme.' ) );
};

export const receiveError = ( { siteId, module }, error ) => {
	return [
		recordTracksEvent( 'calypso_atomic_transfer_inititate_failure', {
			context: module[ 0 ],
			error: error.error,
		} ),
		showErrorNotice( error ),
		pluginUploadError( siteId, error ),
	];
};

export const receiveTransfer = ( action, transfer ) => {
	const { atomic_transfer_id, status } = transfer;
	const { siteId } = action;

	if ( status === transferStates.COMPLETED ) {
		return [
			setAtomicTransfer( siteId, transfer ),
			recordTracksEvent( 'calypso_atomic_transfer_complete', {
				transfer_id: atomic_transfer_id,
			} ),
			atomicTransferComplete( siteId ),
			// Update the now-atomic site to ensure plugin page displays correctly.
			requestSite( siteId ),
		];
	}

	if ( status === transferStates.ERROR ) {
		return [
			setAtomicTransfer( siteId, transfer ),
			receiveError( action, { error: 'api_success_false' } ),
		];
	}

	return [
		setAtomicTransfer( siteId, transfer ),
		fetchAtomicTransfer( siteId, atomic_transfer_id ),
	];
};

export const receiveTransfers = ( store, action, transfers ) =>
	transfers.map( transfer => receiveTransfer( store, action, transfer ) );

export const updateUploadProgress = ( { siteId }, { loaded, total } ) => {
	const progress = total ? ( loaded / total ) * 100 : 0;
	return updatePluginUploadProgress( siteId, progress );
};

registerHandlers( 'state/data-layer/wpcom/sites/atomic/transfer/index.js', {
	[ ATOMIC_TRANSFER_REQUEST ]: [
		dispatchRequestEx( {
			fetch: getTransfer,
			onSuccess: receiveTransfers,
			onError: receiveError,
			onProgress: updateUploadProgress,
		} ),
	],
	[ ATOMIC_TRANSFER_INITIATE ]: [
		dispatchRequestEx( {
			fetch: initiateTransfer,
			onSuccess: receiveTransfers,
			onError: receiveError,
			onProgress: updateUploadProgress,
		} ),
	],
} );
