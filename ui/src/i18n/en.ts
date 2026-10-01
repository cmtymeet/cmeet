// English strings first. Translators copy this file: keys stay stable,
// values change. Views and components take these labels as props so no
// user-visible text is hard-coded where it matters.

export const en = {
  app: {
    name: 'cmeet',
    tagline: 'Good conversations start with the right people.',
    skipToContent: 'Skip to content',
  },
  connection: {
    title: 'Connecting',
    lead: 'Setting up a calm, private connection first. The app opens once it stands.',
    retry: 'Try again',
    failed: 'The connection could not be established.',
  },
  arrival: {
    join: 'Join',
    signIn: 'Sign in',
    joinTitle: 'Join with a voucher',
    signInTitle: 'Welcome back',
    joinLead: 'Use the invitation shared with you by a member.',
    signInLead: 'Use your passkey on this device to sign in.',
    voucherLabel: 'Invitation voucher',
    handleLabel: 'Choose a handle (8 to 32 characters)',
    continue: 'Continue to join',
    signInButton: 'Sign in with passkey',
  },
  lobby: {
    title: 'Lobby',
    lead: 'Complete the remaining requirements in any order.',
    enter: 'Enter forum when admitted',
    devices: 'Devices',
    addDevice: 'Add',
    remove: 'Remove',
  },
  profile: {
    title: 'My profile',
    save: 'Save profile',
    previewFront: 'Front: public profile',
    previewBack: 'Back: private profile',
  },
  forum: {
    title: 'Discover',
    filters: 'Filters',
    wantToKnowMore: 'Want to know more',
    empty: 'No one is around right now.',
  },
  waves: {
    title: 'First contact',
    answer: 'Answer',
    close: 'Respectfully close',
    punish: 'Punish',
    punishNote: 'Punish costs both participants and blocks the sender.',
  },
  contacts: {
    title: 'Contacts',
    block: 'Block',
    unblock: 'Unblock',
  },
  chat: {
    title: 'Messages',
    send: 'Send',
    messageLabel: 'Write a message',
  },
  groups: {
    title: 'Groups',
    join: 'Join',
    leave: 'Leave',
    joined: 'Joined',
    level: { circle: 'Circle', ingroup: 'Ingroup', room: 'Public room' },
    whatChangesNext: 'What changes next',
  },
  devices: {
    title: 'Devices',
    add: 'Add a device',
    approve: 'Approve',
  },
  admin: {
    title: 'Profile schema',
    save: 'Save schema',
    preview: 'Live preview',
  },
  root: {
    title: 'Communities',
  },
  common: {
    cancel: 'Cancel',
    close: 'Close',
    save: 'Save',
    loading: 'Loading…',
    refresh: 'Refresh',
    online: 'Online',
    offline: 'Offline',
  },
};

export type Strings = typeof en;
export type StringKey = string;
