export const MAX_PICKER_SELECTIONS = 20;
export const MAX_PICKER_ADMISSIONS = 100;
export const MAX_PICKER_FILE_ID_LENGTH = 500;
export const MAX_PICKER_NAME_LENGTH = 500;
export const MAX_PICKER_MIME_LENGTH = 200;
export const MAX_PICKER_URL_LENGTH = 2_000;

export interface GooglePickerFile {
  readonly id: string;
  readonly name: string;
  readonly mimeType?: string;
  readonly url?: string;
}

export interface GooglePickerAdmission extends GooglePickerFile {
  readonly admittedAt: number;
}

export interface GooglePickerAdmissionState {
  readonly files: readonly GooglePickerAdmission[];
  readonly revokedFileIds: readonly string[];
}

export interface GoogleDrivePickerOptions {
  readonly multiselect?: boolean;
  readonly mimeTypes?: readonly string[];
}

export interface GoogleDrivePickerAuthority {
  readonly configured: boolean;
  pick(options?: GoogleDrivePickerOptions): Promise<readonly GooglePickerFile[]>;
}
