import type { FloorId } from './state/shell-store.ts';

/**
 * Placeholder project data for the shell until the model is wired up. The handoff says the
 * mockup numbers are illustrative, so parts shows "—" rather than a made-up count.
 */
export interface ProjectSummary {
  name: string;
  specs: { label: string; value: string }[];
}

export interface FloorStop {
  id: FloorId;
  label: string;
  height: string;
}

/** No project open yet (storage still loading): the first-run name. */
export const PLACEHOLDER_PROJECT: ProjectSummary = {
  name: 'New project',
  specs: [
    { label: 'Footprint', value: '12′ × 16′' },
    { label: 'Walls', value: '9′ 0″' },
    { label: 'Roof', value: '6 in 12' },
    { label: 'Parts', value: '—' },
  ],
};

/** Top to bottom, the order the Floors slider draws them. */
export const PLACEHOLDER_FLOORS: FloorStop[] = [
  { id: 'roof', label: 'Roof', height: '12′ 0″' },
  { id: 'floor-1', label: 'Floor 1', height: '9′ 0″' },
  { id: 'foundation', label: 'Foundation', height: '0′ 8″' },
];

