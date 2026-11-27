/**
 * The saved chat for one project (ADR-0002 §D8). Message `content` is any JSON value,
 * so `packages/agent` can store Anthropic content blocks (and file-id references) without
 * a storage migration. Older turns can be folded into `summary`.
 */
import { z } from 'zod';

export const zJsonValue = z.json();
export type JsonValue = z.infer<typeof zJsonValue>;

export const zChatMessage = z.strictObject({
  id: z.string().min(1),
  role: z.enum(['user', 'assistant']),
  /** ms since epoch. */
  at: z.number(),
  /** The Claude turn this message belongs to (matches the history group's turnId). */
  turnId: z.string().optional(),
  content: zJsonValue,
});
export type ChatMessage = z.infer<typeof zChatMessage>;

export const CHAT_LOG_VERSION = 1;

export const zChatLog = z.strictObject({
  version: z.literal(CHAT_LOG_VERSION),
  /** A summary of older turns that were dropped from `messages`. */
  summary: z.string().optional(),
  /**
   * Per-project chat preferences. `confirmBigChanges: true` means the person asked to see a
   * plan before big changes (ADR-0002 §F1, opt-in); absent or false, Claude just builds.
   * Optional, so logs without it still load (version 1).
   */
  prefs: z.strictObject({ confirmBigChanges: z.boolean() }).optional(),
  messages: z.array(zChatMessage),
});
export type ChatLog = z.infer<typeof zChatLog>;

export function emptyChatLog(): ChatLog {
  return { version: CHAT_LOG_VERSION, messages: [] };
}
