/**
 * @slapdash/storage — project storage behind small interfaces (ADR-0001 §10).
 * Adapters are separate entry points (`@slapdash/storage/local`) so the app only pulls
 * in the backend it uses. The shared adapter test suites are in `@slapdash/storage/testing`.
 */
export type {
  Auth,
  AuthResult,
  DeviceState,
  FileRef,
  NewFile,
  ProjectFiles,
  ProjectMeta,
  ProjectRecord,
  ProjectStore,
  ProjectSummary,
  SignInCredentials,
  StorageBackend,
  StoredFile,
  User,
} from './types.ts';
export { StorageError, isStorageError, describeError, type StorageErrorCode } from './errors.ts';
export {
  CHAT_LOG_VERSION,
  emptyChatLog,
  zChatLog,
  zChatMessage,
  zJsonValue,
  type ChatLog,
  type ChatMessage,
  type JsonValue,
} from './chat.ts';
export {
  summarize,
  validateRecord,
  validateRecordBody,
  zProjectMeta,
  zSerializedBus,
  type RecordBody,
  type Validated,
} from './record.ts';
export {
  SLAPDASH_EXTENSION,
  SLAPDASH_FORMAT,
  SLAPDASH_FORMAT_VERSION,
  SLAPDASH_MIME_TYPE,
  decodeSlapdashFile,
  encodeSlapdashFile,
  migrateSlapdashFile,
  slapdashFileName,
  type DecodedSlapdashFile,
  type PortableFile,
} from './format/slapdash-file.ts';
export { base64ToBytes, bytesToBase64 } from './format/base64.ts';
export { newId } from './ids.ts';
export {
  DEFAULT_AUTOSAVE_MS,
  NEW_PROJECT_NAME,
  ProjectSession,
  type ExportedFile,
  type FlushResult,
  type ImportResult,
  type NewChatMessage,
  type SaveResult,
  type SaveStatus,
  type SessionDeps,
} from './session.ts';
