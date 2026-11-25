import { useEffect } from 'react';
import { useMediaQuery } from './hooks/useMediaQuery.ts';
import { useProjectSummary } from './model/floor-stops.ts';
import { NOOP_ACTIONS, type ShellActions } from './shell/actions.ts';
import { DesktopShell } from './shell/DesktopShell.tsx';
import { PhoneShell } from './shell/PhoneShell.tsx';
import { useShellStore } from './state/shell-store.ts';
import { PHONE_BREAKPOINT_PX } from './styles/tokens.ts';

/** Matches widths below the breakpoint (900px and up is desktop). */
export const PHONE_QUERY = `(max-width: ${PHONE_BREAKPOINT_PX - 0.02}px)`;

/**
 * Picks the phone or desktop shell by width. Only one is ever in the DOM. View and floor
 * choices live in the store, so they survive crossing the breakpoint; phone-only popovers and
 * the chat sheet reset.
 */
export function App({ actions = NOOP_ACTIONS }: { actions?: ShellActions }) {
  const isPhone = useMediaQuery(PHONE_QUERY);
  const resetPhone = useShellStore((s) => s.resetPhone);
  const project = useProjectSummary();
  useEffect(() => {
    if (!isPhone) resetPhone();
  }, [isPhone, resetPhone]);
  return isPhone ? (
    <PhoneShell project={project} actions={actions} />
  ) : (
    <DesktopShell project={project} actions={actions} />
  );
}
