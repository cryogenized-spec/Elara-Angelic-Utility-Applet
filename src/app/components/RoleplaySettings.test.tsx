import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RoleplaySettings } from './RoleplaySettings';
import { DEFAULT_ROLEPLAY } from '../../domain/preferences';

describe('RoleplaySettings switch', () => {
  it('renders the reusable ToggleSwitch with switch semantics', () => {
    const off = renderToStaticMarkup(<RoleplaySettings value={{ ...DEFAULT_ROLEPLAY, enabled: false }} onChange={() => {}} />);
    expect(off).toContain('role="switch"');
    expect(off).toContain('aria-checked="false"');
    expect(off).toContain('class="toggle-switch roleplay-switch"');
    const on = renderToStaticMarkup(<RoleplaySettings value={{ ...DEFAULT_ROLEPLAY, enabled: true }} onChange={() => {}} />);
    expect(on).toContain('aria-checked="true"');
    expect(on).toContain('toggle-switch is-on roleplay-switch');
  });
});
