import { requestGoogleToolConfirmation } from './broker';
import type { WriteConfirmationRequest } from './policy';

/** @deprecated Use requestGoogleToolConfirmation for all mutation confirmations. */
export function requestRoleplayConfirmation(request: WriteConfirmationRequest, signal?: AbortSignal): Promise<boolean> {
  return requestGoogleToolConfirmation(request, signal);
}
