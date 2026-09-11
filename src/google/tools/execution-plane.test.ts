import { describe, expect, it } from 'vitest';
import { googleToolRegistry, googleToolsForPlane } from './registry';
import {
  googleGeminiFunctionDeclarations,
  googleGeminiFunctionDeclarationsForPlane,
} from './gemini-declarations';
import { googleCapabilityKeySchema } from '../oauth/contracts';

/**
 * Execution-plane invariants.
 *
 * The Cloudflare Worker builds its Gemini function list from the same central
 * registry the browser uses, but it has no tool executor. Before `executionPlane`
 * existed, any tool added to the registry was advertised by the Worker whether or
 * not the Worker could run it, and the model would call it into a dead end. These
 * tests make that structurally impossible rather than a thing to remember.
 */

const CAPABILITIES_NOT_IN_OAUTH_SCHEMA = ['documents.local', 'media.youtube.read'];

describe('tool execution planes', () => {
  it('excludes every browser-only tool from the Worker surface', () => {
    const browserOnly = googleToolRegistry
      .filter((descriptor) => descriptor.executionPlane === 'browser')
      .map((descriptor) => descriptor.name);

    expect(browserOnly.length).toBeGreaterThan(0);

    const workerNames = googleToolsForPlane('worker').map((descriptor) => descriptor.name);
    for (const name of browserOnly) {
      expect(workerNames, `worker must not advertise ${name}`).not.toContain(name);
    }
  });

  it('excludes browser-only declarations from the Worker function list', () => {
    const workerDeclarations = googleGeminiFunctionDeclarationsForPlane('worker');
    const browserOnly = googleToolRegistry
      .filter((descriptor) => descriptor.executionPlane === 'browser' && descriptor.exposure === 'gemini')
      .map((descriptor) => descriptor.name);

    for (const name of browserOnly) {
      expect(workerDeclarations.map((tool) => tool.name)).not.toContain(name);
    }
  });

  it('advertises youtube.search to the browser but not to the Worker', () => {
    expect(googleGeminiFunctionDeclarations.map((tool) => tool.name)).toContain('youtube.search');
    expect(googleGeminiFunctionDeclarationsForPlane('browser').map((tool) => tool.name)).toContain('youtube.search');
    expect(googleGeminiFunctionDeclarationsForPlane('worker').map((tool) => tool.name)).not.toContain('youtube.search');
  });

  it('keeps tools with no declared plane available on both planes', () => {
    const unassigned = googleToolRegistry.filter((descriptor) => !descriptor.executionPlane);
    expect(unassigned.length).toBeGreaterThan(0);

    const worker = googleToolsForPlane('worker').map((descriptor) => descriptor.name);
    const browser = googleToolsForPlane('browser').map((descriptor) => descriptor.name);
    for (const descriptor of unassigned) {
      expect(worker).toContain(descriptor.name);
      expect(browser).toContain(descriptor.name);
    }
  });

  it('gives the browser every Gemini-visible tool, plane aside', () => {
    const visible = googleToolRegistry.filter((descriptor) => descriptor.exposure === 'gemini').map((d) => d.name);
    expect(googleGeminiFunctionDeclarations.map((tool) => tool.name).sort()).toEqual([...visible].sort());
  });

  it('never exposes an internal-only tool on any plane', () => {
    for (const plane of ['browser', 'worker'] as const) {
      const names = googleGeminiFunctionDeclarationsForPlane(plane).map((tool) => tool.name);
      for (const descriptor of googleToolRegistry.filter((entry) => entry.exposure === 'internal')) {
        expect(names, `${plane} must not expose ${descriptor.name}`).not.toContain(descriptor.name);
      }
    }
  });

  it('resolves every registry capability without throwing at runtime', () => {
    // A typo'd capability would reach `googleCapabilityKeySchema.parse` during
    // execution and blow up mid-tool-call. Catch it here instead.
    for (const descriptor of googleToolRegistry) {
      const known = googleCapabilityKeySchema.safeParse(descriptor.capability).success
        || CAPABILITIES_NOT_IN_OAUTH_SCHEMA.includes(descriptor.capability);
      expect(known, `unresolvable capability "${descriptor.capability}" on ${descriptor.name}`).toBe(true);
    }
  });

  it('marks youtube.search as a read-only, browser-executed, Gemini-visible tool', () => {
    const descriptor = googleToolRegistry.find((entry) => entry.name === 'youtube.search');
    expect(descriptor).toMatchObject({
      risk: 'read',
      capability: 'media.youtube.read',
      exposure: 'gemini',
      executionPlane: 'browser',
    });
  });

  it('keeps the plane accessor pure so it can be called once at module scope', () => {
    const first = googleToolsForPlane('worker');
    const second = googleToolsForPlane('worker');
    expect(first).toEqual(second);
  });
});
