import { describe, expect, it } from 'vitest';
import { getGoogleScope } from './scope-registry';

describe('Gmail OAuth scope classification', () => {
  it('matches the current Google Gmail scope catalog', () => {
    expect(getGoogleScope('gmail.labels')).toMatchObject({ scope: 'https://www.googleapis.com/auth/gmail.labels', sensitivity: 'non-sensitive' });
    expect(getGoogleScope('gmail.send')).toMatchObject({ scope: 'https://www.googleapis.com/auth/gmail.send', sensitivity: 'sensitive' });
    expect(getGoogleScope('gmail.read')).toMatchObject({ scope: 'https://www.googleapis.com/auth/gmail.readonly', sensitivity: 'restricted' });
    expect(getGoogleScope('gmail.modify')).toMatchObject({ scope: 'https://www.googleapis.com/auth/gmail.modify', sensitivity: 'restricted' });
  });
});
