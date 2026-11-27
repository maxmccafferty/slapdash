/**
 * Tools that are not bus commands: queries, the snapshot, the plan and photo requests and
 * the "just do it" preference. The loop runs them in the browser (or in Node for evals)
 * and validates their input with these schemas, because eager input streaming means the
 * API no longer validates tool input. Lengths use `zLength`, so Claude passes "16ft 6in".
 */
import { LENGTH_DESCRIPTION, MATERIAL_CATEGORIES, PART_ROLES, zLength, zPositiveLength } from '@slapdash/core';
import { z } from 'zod';
import { zId } from './ids.ts';
import { zSnapshotRequest } from './snapshot.ts';
import { zCheckStructure } from './structure.ts';

/** A point in project space; y (height) is optional and defaults to the ground. */
export const zQueryPoint = z
  .strictObject({
    x: zLength.describe(`East-west (+x is east). ${LENGTH_DESCRIPTION}`),
    y: zLength.optional().describe(`Height above ground (+y is up). Default 0. ${LENGTH_DESCRIPTION}`),
    z: zLength.describe(`North-south (+z is south). ${LENGTH_DESCRIPTION}`),
  })
  .describe('A point from the ground origin corner (+x east, +z south, y up).');
export type QueryPoint = { x: number; y?: number | undefined; z: number };

const zTarget = z
  .union([zId('A part or assembly id, e.g. W1-S03 or W1.'), zQueryPoint])
  .describe('A part or assembly id, or a point.');

const zPlanXZ = z.strictObject({
  x: zLength.describe(`East-west (+x is east). ${LENGTH_DESCRIPTION}`),
  z: zLength.describe(`North-south (+z is south). ${LENGTH_DESCRIPTION}`),
});

export const zFindParts = z.strictObject({
  assembly: zId('Only parts in this assembly, e.g. W1.').optional(),
  role: z.enum(PART_ROLES).optional().describe('Only parts with this role, e.g. "stud".'),
  material: zId('Only parts of this material id, e.g. spf-no2 (a part of the id matches too).').optional(),
  tag: z.string().min(1).optional().describe('Only parts with this tag, e.g. "king" or "corner-backer".'),
  near: zQueryPoint.optional().describe('Only parts near this point, nearest first.'),
  within: zPositiveLength.optional().describe(`With "near": how close a part must be. Default 1ft. ${LENGTH_DESCRIPTION}`),
  limit: z.number().int().min(1).max(200).default(50).describe('How many rows to list. Default 50.'),
});

export const zGetPart = z.strictObject({
  id: zId('A part id (W1-S03) or an assembly id (W1).'),
});

export const zMeasure = z.strictObject({
  from: zTarget,
  to: zTarget,
});

export const zListMaterials = z.strictObject({
  assembly: zId('Only this assembly, e.g. W1. Default: the whole project.').optional(),
});

export const zSearchCatalog = z.strictObject({
  text: z.string().trim().min(1).optional().describe('Words to match in the id, name or description, e.g. pool fence or gfci. All words must match.'),
  category: z.enum(MATERIAL_CATEGORIES).optional().describe('Only this category, e.g. fencing, plumbing or roofing.'),
  flag: z.string().min(1).optional().describe('Only materials with this code flag, e.g. pool-barrier, safety-glazing or licensed-trade.'),
  limit: z.number().int().min(1).max(100).default(25).describe('How many rows to list. Default 25.'),
});

export const zProposePlan = z.strictObject({
  plan: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .refine((s) => !s.includes('\n'), 'should be one line')
    .describe('One line, e.g. "I\'ll build a 16×20 shell on a slab with 9ft walls and a 6/12 gable roof."'),
  footprint: z
    .strictObject({ from: zPlanXZ, to: zPlanXZ })
    .optional()
    .describe('Plan corners of what you will build; the app draws it as a dashed outline.'),
  height: zPositiveLength.optional().describe(`Overall height, for the outline. ${LENGTH_DESCRIPTION}`),
});
export type PlanProposal = z.output<typeof zProposePlan>;

export const zRequestPhoto = z.strictObject({
  what: z.string().trim().min(1).max(200).describe('What to photograph, e.g. "the wall where the deck attaches".'),
});

export const zSetPreferences = z.strictObject({
  confirmBigChanges: z.boolean().describe('true: show a plan before big changes. false: just build (the default).'),
});

export const zOfferOptions = z.strictObject({
  options: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(80)
        .refine((s) => !s.includes('\n'), 'should be one line'),
    )
    .min(2)
    .max(3)
    .describe('Two (at most three) one-line choices, phrased as the person would say them, e.g. "Use a beam with a post in the middle".'),
});

export interface AgentToolDef {
  name: string;
  description: string;
  schema: z.ZodType;
}

/** The agent tools, in the fixed order they follow the command and history tools. */
export const agentToolDefs = [
  {
    name: 'find_parts',
    description:
      'Find parts by assembly, role, material, tag or nearness to a point. Returns a total count and one row per part: id · role · name · assembly · material/section · length. Use it to get ids before editing or measuring.',
    schema: zFindParts,
  },
  {
    name: 'get_part',
    description:
      'Details of one part (role, material, size, position, rotation, build step, tags, joints) or one assembly (kind, how its builder made it, part counts by role, bounds).',
    schema: zGetPart,
  },
  {
    name: 'measure',
    description:
      'Measure between two parts, assemblies or points: centre-to-centre distance, dx/dy/dz, and the clear gap between their bounds (or how far they overlap). Use this for exact numbers instead of reading an image.',
    schema: zMeasure,
  },
  {
    name: 'list_materials',
    description:
      'A materials list for the project or one assembly: pieces and linear feet per material and size, sheet goods in square feet and sheets, concrete in cubic yards, and fasteners from the joints. Quantities only.',
    schema: zListMaterials,
  },
  {
    name: 'search_catalog',
    description:
      'Search the material catalog by words, category or code flag. Returns a count and one row per material: id · name · category · flags, with a short description. Use it to find a material id before using one you have not seen.',
    schema: zSearchCatalog,
  },
  {
    name: 'snapshot',
    description:
      "Take a picture of the model to look at it. Default is a four-view sheet (top, front, right and 3D on one image). The person's own view never moves. Highlight ids to outline them in orange. Images are for noticing; measure for numbers.",
    schema: zSnapshotRequest,
  },
  {
    name: 'check_structure',
    description:
      'Run the structural check (planning estimate) and list the most loaded parts and joints with % of limit, governing check and the design loads with their sources. Use it when the stress view is on, before suggesting a fix, and after a fix to confirm it clears.',
    schema: zCheckStructure,
  },
  {
    name: 'propose_plan',
    description:
      'Only while the big-change check is on (the person asked to see plans first): show a one-line plan with Build it / Change something before a big change (a new structure, a roof, or about 50+ parts). Give the footprint and height when you know them. Then stop and wait for their answer.',
    schema: zProposePlan,
  },
  {
    name: 'request_photo',
    description:
      'Ask the person for a photo when one would settle a question about their site (an existing wall, a slope, where something attaches). The app offers the camera. Then stop and wait.',
    schema: zRequestPhoto,
  },
  {
    name: 'set_preferences',
    description:
      'Call with true when the person wants to see a plan before big changes; false when they want you to just build again (the default).',
    schema: zSetPreferences,
  },
  {
    name: 'offer_options',
    description:
      "When you can't do what was asked, offer two ways that would work as tappable choices. Also after explaining a weak spot found by the stress check: the fix and Leave it, fix first when it is over the limit. Phrase each as the person would say it. Then stop.",
    schema: zOfferOptions,
  },
] as const satisfies readonly AgentToolDef[];

export type AgentToolName = (typeof agentToolDefs)[number]['name'];

export const AGENT_TOOL_NAMES: ReadonlySet<string> = new Set(agentToolDefs.map((d) => d.name));
