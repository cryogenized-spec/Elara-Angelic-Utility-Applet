import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './conversation';
import {
  admitGooglePickerFiles,
  assertGooglePickerFileAllowed,
  clearGooglePickerAdmissions,
  filterRevokedGooglePickerFiles,
  loadGooglePickerAdmissions,
  revokeGooglePickerFile,
} from './google-picker-admissions';

describe('Google Picker admissions', () => {
  beforeEach(async () => {
    await db.settings.delete('google-picker-admissions');
  });

  it('admits bounded files, revokes them locally, and requires an explicit re-pick', async () => {
    await admitGooglePickerFiles([
      { id: 'file-1', name: 'Plan', mimeType: 'application/vnd.google-apps.document', url: 'https://docs.google.com/document/d/file-1/edit' },
    ], 100);

    await expect(assertGooglePickerFileAllowed('file-1')).resolves.toBeUndefined();
    await expect(loadGooglePickerAdmissions()).resolves.toMatchObject({ files: [{ id: 'file-1', admittedAt: 100 }], revokedFileIds: [] });

    await revokeGooglePickerFile('file-1', 200);
    await expect(assertGooglePickerFileAllowed('file-1')).rejects.toThrow(/removed from Elara/i);
    await expect(filterRevokedGooglePickerFiles([{ id: 'file-1' }, { id: 'file-2' }])).resolves.toEqual([{ id: 'file-2' }]);

    await admitGooglePickerFiles([{ id: 'file-1', name: 'Plan' }], 300);
    await expect(assertGooglePickerFileAllowed('file-1')).resolves.toBeUndefined();
    await expect(loadGooglePickerAdmissions()).resolves.toMatchObject({ files: [{ id: 'file-1', admittedAt: 300 }], revokedFileIds: [] });
  });

  it('clears active admissions into the deny set on disconnect-style cleanup', async () => {
    await admitGooglePickerFiles([{ id: 'file-1', name: 'One' }, { id: 'file-2', name: 'Two' }], 100);
    await clearGooglePickerAdmissions(200);

    const state = await loadGooglePickerAdmissions();
    expect(state.files).toEqual([]);
    expect(state.revokedFileIds).toEqual(expect.arrayContaining(['file-1', 'file-2']));
    await expect(assertGooglePickerFileAllowed('file-2')).rejects.toThrow(/removed from Elara/i);
  });
});
