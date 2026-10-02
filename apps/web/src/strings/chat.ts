// English strings for the direct chat view.
// Views use these labels so future translations copy this file only.

export const chatStrings = {
  title: 'Messages',
  messageLabel: 'Write a message',
  send: 'Send',
  sending: 'Sending…',
  working: 'Working…',
  loading: 'Loading…',
  empty: 'No messages yet. Say hello.',
  historyNote:
    'History shown here lives on your devices while records remain available. There is no permanent backup.',
  statusActive: 'Active',
  statusClosed: 'Closed',
  statusBlocked: 'Blocked',
  statusReopenPending: 'Reopen requested',
  establishedNote: 'Established conversations are unmetered.',
  waitingNote: 'Waiting for the introduction to complete. Established conversations are unmetered.',
  closedNote: 'This conversation is closed. You can ask the other member to reopen it.',
  blockedNote: 'This conversation is blocked. Unblock from Contacts to see it in discovery again.',
  reopenPendingNote: 'A reopen request is waiting with the other member. Nothing is open yet.',
  queuedLabel: 'Queued on your device',
  storedLabel: 'Stored for delivery',
  receivedLabel: 'Received',
  closeAction: 'Respectfully close',
  blockAction: 'Block',
  punishAction: 'Punish',
  confirmPunish: 'Confirm punish',
  cancel: 'Cancel',
  reopenAction: 'Request reopen',
  punishCost:
    'Punish costs both participants one introduction each and blocks the other member. It cannot be undone here.',
  loadFailed: 'This conversation is unavailable.',
  sendFailed: 'The message did not go out. Your draft is kept above.',
  actionFailed: 'That did not work. Try again.',
} as const;

export type ChatStrings = typeof chatStrings;
