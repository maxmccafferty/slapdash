/**
 * Sync status in words: the one-off chat notes and the Projects modal's line. Plain and
 * calm: work is never lost while the cloud is away, it waits on the device.
 */
import { CLOUD_UNAVAILABLE_MESSAGE, type SyncConflict, type SyncStatus } from '@slapdash/storage';

export const OFFLINE_NOTE = "Can't reach the cloud right now. Your work is saved on this device and will sync when it's back.";
export const SYNCED_NOTE = 'Synced.';
export const SYNCED_LINE = 'Synced across your devices.';
export const SYNCING_LINE = 'Syncing…';
export const OFFLINE_LINE = "Can't reach the cloud right now: showing what's on this device.";

/** The chat note when sync goes offline: the status's own sentence unless it's the generic one. */
export function offlineNote(status: Extract<SyncStatus, { kind: 'offline' }>): string {
  return status.message === CLOUD_UNAVAILABLE_MESSAGE ? OFFLINE_NOTE : status.message;
}

/** The Projects modal's line. */
export function syncLine(status: SyncStatus): string {
  switch (status.kind) {
    case 'synced':
      return SYNCED_LINE;
    case 'syncing':
      return SYNCING_LINE;
    case 'offline':
      return OFFLINE_LINE;
  }
}

export function movedNote(count: number): string {
  return `Moved ${count} project${count === 1 ? '' : 's'} from this device into your account.`;
}

export function conflictNote(conflict: SyncConflict, name: string): string {
  return `"${name}" was also changed on another device. That version is open now, and the one from this device is kept as "${conflict.copyName}".`;
}
