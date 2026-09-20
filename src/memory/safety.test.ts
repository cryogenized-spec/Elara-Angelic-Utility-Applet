import { describe, expect, it } from 'vitest';
import { containsCredentialMaterial, sensitiveMemoryCategoryHints } from './safety';

describe('memory safety policy', () => {
  it('keeps authentication and financial account identifiers outside durable memory', () => {
    expect(containsCredentialMaterial('Password: example-value')).toBe(true);
    expect(containsCredentialMaterial('Bank account number: 1234567890')).toBe(true);
    expect(containsCredentialMaterial('IBAN is ZA00EXAMPLE000000')).toBe(true);
    expect(containsCredentialMaterial('My monthly budget is R3000')).toBe(false);
  });

  it('emits narrow deterministic hints for obvious sensitive evidence', () => {
    expect(sensitiveMemoryCategoryHints('I was diagnosed with diabetes')).toEqual(['health_wellbeing']);
    expect(sensitiveMemoryCategoryHints('My religion is Buddhism')).toEqual(['religion_spirituality']);
    expect(sensitiveMemoryCategoryHints('My home address is 10 Example Street')).toEqual(['precise_location_home']);
    expect(sensitiveMemoryCategoryHints('My cat is named Piesang')).toEqual([]);
  });
});
