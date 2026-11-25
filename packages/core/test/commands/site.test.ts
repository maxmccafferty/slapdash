import { describe, expect, it } from 'vitest';
import { KPA_PER_PSF, MS_PER_MPH, createProject } from '../../src/index.ts';
import { expectRoundTrip, runErr, runOk } from '../helpers.ts';

describe('set_site_location', () => {
  it('sets and clears the per-project location', () => {
    const res = expectRoundTrip(createProject({ name: 't' }), 'set_site_location', { location: { label: 'Bend, OR', lat: 44.06, lon: -121.31 } });
    expect(res.project.site.location).toEqual({ label: 'Bend, OR', lat: 44.06, lon: -121.31, source: 'project' });
    const cleared = expectRoundTrip(res.project, 'set_site_location', { location: null });
    expect(cleared.project.site.location).toBeUndefined();
    expect(cleared.summary).toContain('using the default');
  });

  it('semantic errors', () => {
    const p = createProject({ name: 't' });
    expect(runErr(p, 'set_site_location', { location: { label: 'x', lat: 91 } })[0]).toMatchObject({ path: 'location.lat', message: 'Latitude must be between -90 and 90 (you gave 91).' });
    expect(runErr(p, 'set_site_location', { location: { label: 'x', lon: -200 } })[0]!.path).toBe('location.lon');
  });

  it('schema errors', () => {
    const p = createProject({ name: 't' });
    expect(runErr(p, 'set_site_location', {})[0]!.message).toBe('"location" is required.');
    expect(runErr(p, 'set_site_location', { location: { label: '' } })[0]!.message).toBe(`"location.label" can't be blank.`);
  });
});

describe('set_design_load', () => {
  it('stores SI values with their source', () => {
    const res = expectRoundTrip(createProject({ name: 't' }), 'set_design_load', { key: 'groundSnow', value: '30 psf', source: 'county building dept' });
    expect(res.project.site.designLoads.groundSnow).toEqual({ value: 30 * KPA_PER_PSF, unit: 'kPa', source: 'county building dept' });
    expect(res.summary).toBe('Set the ground snow load to 30 psf (source: county building dept).');
    const wind = expectRoundTrip(res.project, 'set_design_load', { key: 'windSpeed', value: '115 mph', source: 'user', note: 'ASCE hazard tool' });
    expect(wind.project.site.designLoads.windSpeed).toEqual({ value: 115 * MS_PER_MPH, unit: 'm/s', source: 'user', note: 'ASCE hazard tool' });
    const frost = expectRoundTrip(wind.project, 'set_design_load', { key: 'frostDepth', value: '3ft', source: 'user' });
    expect(frost.project.site.designLoads.frostDepth!.value).toBeCloseTo(914.4);
  });

  it('semantic errors', () => {
    const p = createProject({ name: 't' });
    expect(runErr(p, 'set_design_load', { key: 'groundSnow', value: '400 psf', source: 'user' })[0]!.message).toBe(
      'A ground snow load of 400 psf is outside the plausible range (0 psf to 313.3 psf).',
    );
    expect(runErr(p, 'set_design_load', { key: 'windSpeed', value: '115', source: 'user' })[0]!.message).toContain('has no unit');
    expect(runErr(p, 'set_design_load', { key: 'frostDepth', value: -5, source: 'user' })[0]!.code).toBe('invalid_input');
  });

  it('schema errors', () => {
    const p = createProject({ name: 't' });
    expect(runErr(p, 'set_design_load', { key: 'snow', value: 1, source: 'user' })[0]).toMatchObject({ path: 'key' });
    expect(runErr(p, 'set_design_load', { key: 'groundSnow', value: 1 })[0]!.message).toBe('"source" is required.');
  });
});

describe('clear_design_load', () => {
  it('removes an override', () => {
    const p = runOk(createProject({ name: 't' }), 'set_design_load', { key: 'frostDepth', value: 900, source: 'user' }).project;
    const res = expectRoundTrip(p, 'clear_design_load', { key: 'frostDepth' });
    expect(res.project.site.designLoads).toEqual({});
  });

  it('semantic and schema errors', () => {
    const p = createProject({ name: 't' });
    expect(runErr(p, 'clear_design_load', { key: 'frostDepth' })[0]).toMatchObject({
      code: 'not_found',
      message: 'This project has no frost depth override to clear.',
    });
    expect(runErr(p, 'clear_design_load', {})[0]!.message).toContain('"key" is required');
  });
});
