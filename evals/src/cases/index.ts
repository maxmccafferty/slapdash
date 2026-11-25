/** Every scenario, in run order: full builds, edits on seeded models, then behaviour checks. */
import type { Scenario } from '../scenario.ts';
import { clashAvoidance } from './clash-avoidance.ts';
import { fence } from './fence.ts';
import { gableRoof } from './gable-roof.ts';
import { justDoIt } from './just-do-it.ts';
import { pergolaPolycarbonateScenario } from './pergola-polycarbonate.ts';
import { planRevision } from './plan-revision.ts';
import { poolHouse } from './pool-house.ts';
import { poolFenceScenario } from './pool-fence.ts';
import { poolHouseSlidingDoor } from './pool-house-sliding-door.ts';
import { questionNoChange } from './question-no-change.ts';
import { refuseImpossibleSpan } from './refuse-impossible-span.ts';
import { shedRoof } from './shed-roof.ts';
import { smallChangeNoPlan } from './small-change-no-plan.ts';
import { undo } from './undo.ts';

export const SCENARIOS: readonly Scenario[] = [
  poolHouse,
  poolHouseSlidingDoor,
  fence,
  shedRoof,
  gableRoof,
  pergolaPolycarbonateScenario,
  poolFenceScenario,
  refuseImpossibleSpan,
  undo,
  smallChangeNoPlan,
  planRevision,
  justDoIt,
  clashAvoidance,
  questionNoChange,
];
