/**
 * When Stress is switched on and the first result shows the most loaded visible part at
 * 80% or more of its limit, anything over, or anything unstable, the chat runs one
 * automatic turn: Claude explains in a sentence or two and offers the fix. Once per
 * switch-on, only when Claude is connected and idle. Below 80% there is only the callout,
 * with no paid turn.
 */
import type { ChatController } from '../agent/chat-controller.ts';
import { useChatStore } from '../state/chat-store.ts';
import { useModelStore } from '../state/model-store.ts';
import { useShellStore } from '../state/shell-store.ts';
import { isPartVisible } from '../renderer/visibility.ts';
import { shouldExplain, stressContext } from './stress.ts';
import { useStressStore } from './stress-store.ts';

export function watchStressExplain(chat: Pick<ChatController, 'explainStress'>): () => void {
  return useStressStore.subscribe((s) => {
    if (s.status !== 'ready' || !s.result || !s.forProject || s.switchOn === 0 || s.explainedFor === s.switchOn) return;
    const shell = useShellStore.getState();
    if (!shell.stress || shell.view !== '3d') return;
    // The first result after this switch-on: considered once, whatever happens next.
    useStressStore.setState({ explainedFor: s.switchOn });
    const project = s.forProject;
    const opts = { floor: shell.floor, lookFrom: shell.lookFrom };
    const ctx = stressContext(project, s.result, (id) => {
      const part = project.parts[id];
      return part ? isPartVisible(part, project.assemblies[part.assemblyId], opts) : false;
    });
    if (!shouldExplain(ctx)) return;
    const chatState = useChatStore.getState();
    if (chatState.connection !== 'ready' || chatState.running) return;
    if (useModelStore.getState().project !== project) return;
    void chat.explainStress(ctx);
  });
}
