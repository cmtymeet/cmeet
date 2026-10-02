// English strings for the groups list.
// Views use these labels so future translations copy this file only.
// All levels, bands and transitions are opaque display data from cmsg;
// this file holds presentation copy only, never policy.

export const groupsStrings = {
  title: 'Groups',
  lead: "One group idea at three sizes. Growing more visible always needs everyone's consent; shrinking stays private on its own. Joining never costs a wave.",
  loading: 'Loading…',
  loadFailed: 'Groups are unavailable right now.',
  retry: 'Try again',
  emptyTitle: 'No groups yet',
  emptyHint: 'Seed rooms from your community will appear here.',
  join: 'Join',
  leave: 'Leave',
  joined: 'Joined',
  joiningBusy: 'Joining…',
  leavingBusy: 'Leaving…',
  whatChangesNext: 'What changes next',
  members: 'members',
  level: {
    circle: 'Circle',
    ingroup: 'Ingroup',
    room: 'Public room',
    opening: 'Opening room',
  },
  notificationsLabel: 'Notifications',
  paceLabel: 'Posting pace',
  joiningLabel: 'Joining',
  historyLabel: 'Newcomer history',
  openingLabel: 'Opening',
  seatLabel: 'Seat budget',
  suggestionLabel: 'Invitation',
  openDetails: 'Open details',
  joinTitlePrefix: 'Join',
  consentCheckbox: 'I understand and consent to this visibility.',
  consentNote: 'Joining, forking, merging and splitting never cost a Wave.',
  cancel: 'Cancel',
  joinFailed: 'Joining did not work.',
  leaveFailed: 'Leaving did not work.',
} as const;

export type GroupsStrings = typeof groupsStrings;
