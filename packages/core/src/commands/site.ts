import { z } from 'zod';
import {
  DESIGN_LOAD_RANGES,
  designLoadLabel,
  designLoadUnit,
  formatLoad,
  parseDesignLoad,
} from '../site/design-loads.ts';
import { zDesignLoadKey, type SiteSettings } from '../model/schema.ts';
import { commandError, type CommandError } from './errors.ts';
import { zNonBlank } from './common.ts';
import { defineCommand } from './types.ts';

export const setSiteLocation = defineCommand({
  name: 'set_site_location',
  description:
    'Set this project\'s location, which overrides the app\'s default location for design loads. Pass location: null to go back to the default.',
  exposed: true,
  schema: z.strictObject({
    location: z
      .strictObject({
        label: zNonBlank('Place name, e.g. "Bend, OR".'),
        lat: z.number().optional().describe('Latitude in degrees, -90 to 90.'),
        lon: z.number().optional().describe('Longitude in degrees, -180 to 180.'),
      })
      .nullable()
      .describe('The location, or null to clear the project override.'),
  }),
  check(_project, input) {
    const errors: CommandError[] = [];
    const loc = input.location;
    if (loc?.lat !== undefined && (loc.lat < -90 || loc.lat > 90)) {
      errors.push(commandError('invalid_input', `Latitude must be between -90 and 90 (you gave ${loc.lat}).`, { path: 'location.lat' }));
    }
    if (loc?.lon !== undefined && (loc.lon < -180 || loc.lon > 180)) {
      errors.push(commandError('invalid_input', `Longitude must be between -180 and 180 (you gave ${loc.lon}).`, { path: 'location.lon' }));
    }
    return errors;
  },
  apply(project, input) {
    const site: SiteSettings = { ...project.site };
    if (input.location === null) delete site.location;
    else {
      site.location = { label: input.location.label, source: 'project' };
      if (input.location.lat !== undefined) site.location.lat = input.location.lat;
      if (input.location.lon !== undefined) site.location.lon = input.location.lon;
    }
    return {
      project: { ...project, site },
      inverse: [{ name: 'set_site', input: { site: project.site } }],
      redo: { name: 'set_site_location', input },
      summary: input.location === null ? 'Cleared the project location; using the default.' : `Set the project location to ${input.location.label}.`,
      created: [],
    };
  },
});

const zLoadValue = z
  .union([z.number(), z.string()], { error: 'should be a number (SI) or text with a unit like "30 psf"' })
  .describe(
    'The value. Text with a unit: snow "30 psf" or "1.44 kPa"; wind "115 mph" or "51 m/s"; frost depth "36in" or "915mm". A bare number is SI (kPa, m/s, mm).',
  );

export const setDesignLoad = defineCommand({
  name: 'set_design_load',
  description:
    'Override one design load for this project (ground snow load, wind speed or frost depth), with where the number came from.',
  exposed: true,
  schema: z.strictObject({
    key: zDesignLoadKey.describe('Which load.'),
    value: zLoadValue,
    source: zNonBlank('Where the number came from, e.g. "county building dept" or "user".'),
    note: z.string().optional(),
  }),
  check(_project, input) {
    const parsed = parseDesignLoad(input.key, input.value);
    if (!parsed.ok) return [commandError('invalid_input', parsed.error, { path: 'value' })];
    const { min, max } = DESIGN_LOAD_RANGES[input.key];
    if (parsed.value < min || parsed.value > max) {
      return [
        commandError(
          'invalid_input',
          `A ${designLoadLabel(input.key)} of ${formatLoad(input.key, parsed.value)} is outside the plausible range (${formatLoad(input.key, min)} to ${formatLoad(input.key, max)}).`,
          { path: 'value', hint: 'Check the number and unit.' },
        ),
      ];
    }
    return [];
  },
  apply(project, input) {
    const parsed = parseDesignLoad(input.key, input.value);
    if (!parsed.ok) throw new Error(parsed.error);
    const override = { value: parsed.value, unit: designLoadUnit(input.key), source: input.source, ...(input.note !== undefined ? { note: input.note } : {}) };
    const site: SiteSettings = { ...project.site, designLoads: { ...project.site.designLoads, [input.key]: override } };
    return {
      project: { ...project, site },
      inverse: [{ name: 'set_site', input: { site: project.site } }],
      redo: { name: 'set_design_load', input: { ...input, value: parsed.value } },
      summary: `Set the ${designLoadLabel(input.key)} to ${formatLoad(input.key, parsed.value)} (source: ${input.source}).`,
      created: [],
    };
  },
});

export const clearDesignLoad = defineCommand({
  name: 'clear_design_load',
  description: 'Remove this project\'s override for one design load, going back to the default value.',
  exposed: true,
  schema: z.strictObject({
    key: zDesignLoadKey.describe('Which load.'),
  }),
  check(project, input) {
    if (!project.site.designLoads[input.key]) {
      return [commandError('not_found', `This project has no ${designLoadLabel(input.key)} override to clear.`, { path: 'key' })];
    }
    return [];
  },
  apply(project, input) {
    const designLoads = { ...project.site.designLoads };
    delete designLoads[input.key];
    return {
      project: { ...project, site: { ...project.site, designLoads } },
      inverse: [{ name: 'set_site', input: { site: project.site } }],
      redo: { name: 'clear_design_load', input },
      summary: `Cleared the ${designLoadLabel(input.key)} override; using the default.`,
      created: [],
    };
  },
});

export const siteCommands = [setSiteLocation, setDesignLoad, clearDesignLoad];
