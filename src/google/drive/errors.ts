/**
 * Drive transfer failures.
 *
 * The provider adapter owns this vocabulary; the tool boundary maps it onto
 * artifact error codes. Keeping it typed means a size ceiling, an unsupported
 * file and a provider failure stay distinguishable all the way to the model and
 * the artifact record instead of collapsing into one generic provider error.
 */
export type DriveTransferErrorCode =
  | 'DRIVE_FILE_TOO_LARGE'
  | 'DRIVE_FILE_UNSUPPORTED'
  | 'DRIVE_TRANSFER_FAILED';

export class DriveTransferError extends Error {
  readonly code: DriveTransferErrorCode;

  constructor(code: DriveTransferErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'DriveTransferError';
    this.code = code;
    this.cause = cause;
  }
}
