// English strings for the contacts view.
// Views use these labels so future translations copy this file only.

export const contactsStrings = {
  title: 'Contacts',
  lead: 'People you have answered or written to. Presence here is peer to peer; the forum never keeps your contact list. Blocking hides you in the forum while you are online; your devices remember the block.',
  loading: 'Loading contacts…',
  empty: 'No contacts yet',
  emptyHint: 'Answer a wave and the conversation starts here.',
  refresh: 'Refresh',
  retry: 'Try again',
  failed: 'Contacts are unavailable right now.',
  actionFailed: 'That did not work. Try again.',
  online: 'Online',
  offline: 'Offline',
  statusEstablished: 'Established',
  statusClosed: 'Closed',
  statusBlocked: 'Blocked',
  statusPending: 'Pending',
  statusUnknown: 'Unknown',
  openChat: 'Open chat',
  block: 'Block',
  unblock: 'Unblock',
  requestReopen: 'Request reopening',
  blockBusy: 'Blocking…',
  unblockBusy: 'Unblocking…',
  reopenBusy: 'Requesting…',
  blockedNote: 'Blocked. Unblocking leaves the conversation closed; it never opens chat by itself.',
  closedNote: 'Closed. Reopening needs an explicit request; unblocking alone never reopens chat.',
  pendingNote: 'A reopening request is waiting.',
} as const;

export type ContactsStrings = typeof contactsStrings;
