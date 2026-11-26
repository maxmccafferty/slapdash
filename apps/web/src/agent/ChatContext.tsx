import { createContext, useContext, type ReactNode } from 'react';
import type { ChatController } from './chat-controller.ts';

const ChatContext = createContext<ChatController | null>(null);

export function ChatProvider({ controller, children }: { controller: ChatController; children: ReactNode }) {
  return <ChatContext.Provider value={controller}>{children}</ChatContext.Provider>;
}

/** A controller that does nothing, for rendering the shell without Claude (component tests). */
const INERT: ChatController = {
  start: async () => {},
  send: async () => null,
  approvePlan: async () => null,
  explainStress: async () => null,
  changePlan: () => {},
  chooseOption: async () => null,
  undoTurn: () => {},
  canUndo: () => false,
  stop: () => {},
  startTalking: () => {},
  stopTalking: async () => {},
  stopSpeaking: () => {},
  attachPhoto: async () => {},
  removePhoto: () => {},
  openSample: () => {},
  dispose: () => {},
};

export function useChat(): ChatController {
  return useContext(ChatContext) ?? INERT;
}
