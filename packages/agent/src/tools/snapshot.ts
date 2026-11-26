/**
 * The `snapshot` request (ADR-0002 §B10): how Claude (or a test) asks for a picture of the
 * model. It renders offscreen in the browser, so the user's camera never moves. The schema
 * lives here so the tool list and the agent loop can use it; `apps/web` re-exports it and
 * supplies the renderer through a `SnapshotProvider`.
 *
 * Errors are plain sentences, the same shape as command errors, because they go back to
 * Claude as tool results (ADR-0002 §A7).
 */
import { z } from 'zod';
import { zId, zIdList } from './ids.ts';
import { commandError, formatErrors, notFound, zodIssuesToErrors, type CommandError, type Project } from '@slapdash/core';

export const SNAPSHOT_ANGLES = ['sheet', 'top', 'front', 'back', 'left', 'right', 'iso'] as const;
export const SNAPSHOT_MODES = ['textured', 'blueprint', 'xray', 'stress', 'exploded'] as const;

export const zSnapshotRequest = z.strictObject({
  angle: z
    .union([z.enum(SNAPSHOT_ANGLES), z.strictObject({ frame: zId('A part or assembly id to frame.') })])
    .default('sheet')
    .describe('A named view, "sheet" (top, front, right and 3D on one image), or { frame: id }.'),
  mode: z.enum(SNAPSHOT_MODES).default('textured'),
  highlight: zIdList('Part or assembly ids to outline in orange.').max(200).default([]),
  labels: z.boolean().default(false).describe('Draw ID labels.'),
  dimensions: z.boolean().default(false),
  lookFrom: z.enum(['outside', 'inside']).default('outside'),
  floor: z.enum(['roof', 'floor-1', 'foundation']).default('roof'),
  size: z.number().int().min(256).max(2048).default(768).describe('Long edge, in px.'),
});
export type SnapshotRequest = z.output<typeof zSnapshotRequest>;
export type SnapshotRequestInput = z.input<typeof zSnapshotRequest>;
export type SnapshotAngle = SnapshotRequest['angle'];
export type SnapshotMode = SnapshotRequest['mode'];
/** Modes the renderer can actually draw. */
export type RenderableMode = Exclude<SnapshotMode, 'stress' | 'exploded'>;
export type RenderableSnapshotRequest = SnapshotRequest & { mode: RenderableMode };

/** A snapshot error that carries the command-style errors for the tool result. */
export class SnapshotError extends Error {
  readonly errors: CommandError[];
  constructor(errors: CommandError[]) {
    super(formatErrors(errors).replace(/\n/g, ' '));
    this.name = 'SnapshotError';
    this.errors = errors;
  }
}

export type ValidatedSnapshot = { ok: true; request: RenderableSnapshotRequest } | { ok: false; errors: CommandError[] };

/** Parse the request and check every id it names against the project. */
export function validateSnapshotRequest(raw: unknown, project: Project): ValidatedSnapshot {
  const parsed = zSnapshotRequest.safeParse(raw ?? {});
  if (!parsed.success) return { ok: false, errors: zodIssuesToErrors(parsed.error.issues, raw) };
  const req = parsed.data;
  if (req.mode === 'stress') {
    return { ok: false, errors: [commandError('not_allowed', "Stress view isn't available yet.", { path: 'mode' })] };
  }
  if (req.mode === 'exploded') {
    return {
      ok: false,
      errors: [commandError('not_allowed', 'Exploded view was replaced by build steps.', { path: 'mode', hint: 'Use textured, blueprint or xray.' })],
    };
  }
  const ids = [...Object.keys(project.parts), ...Object.keys(project.assemblies)];
  const known = (id: string) => id in project.parts || id in project.assemblies;
  const errors: CommandError[] = [];
  req.highlight.forEach((id, i) => {
    if (!known(id)) errors.push(notFound('part or assembly', id, ids, `highlight[${i}]`));
  });
  if (typeof req.angle === 'object' && !known(req.angle.frame)) errors.push(notFound('part or assembly', req.angle.frame, ids, 'angle.frame'));
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, request: req as RenderableSnapshotRequest };
}

/** Highlight ids → part ids (an assembly id means all its parts). */
export function expandIds(project: Project, ids: readonly string[]): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    if (id in project.parts) out.add(id);
    else if (id in project.assemblies) for (const p of Object.values(project.parts)) if (p.assemblyId === id) out.add(p.id);
  }
  return [...out];
}

/** A rendered snapshot, as the agent needs it: a base64 PNG plus notes for Claude. */
export interface SnapshotImage {
  /** Base64-encoded PNG, no `data:` prefix. */
  data: string;
  width: number;
  height: number;
  angle: string;
  mode: string;
  notes: string[];
}

/**
 * Renders a validated request. In the browser this wraps the offscreen renderer; in Node
 * (evals) there is none and the snapshot tool says so. Throw a `SnapshotError` to refuse.
 */
export type SnapshotProvider = (request: RenderableSnapshotRequest) => Promise<SnapshotImage>;

/** A short description of a snapshot, used for the stub text when its image ages out. */
export function snapshotLabel(request: SnapshotRequest): string {
  const angle =
    typeof request.angle === 'object'
      ? `framed on ${request.angle.frame}`
      : request.angle === 'sheet'
        ? 'four-view sheet'
        : request.angle === 'iso'
          ? '3D view'
          : `${request.angle} view`;
  return `${angle}, ${request.mode}, ${request.size}px`;
}
