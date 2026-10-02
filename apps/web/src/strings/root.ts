// English strings for the root (platform) settings surface.
// Views use these labels so future translations copy this file only.

export const rootStrings = {
  title: 'Communities',
  lead: 'Select a community to manage its settings and admins. Sign in with your passkey to enter this portal.',
  signIn: 'Sign in as root',
  signInBusy: 'Waiting for passkey…',
  signInFailed: 'Sign in did not work. Try again.',
  communitiesHeading: 'Communities',
  select: 'Select',
  selected: 'Selected',
  loadingCommunity: 'Loading community…',
  settingsHeading: 'Settings',
  adminsHeading: 'Admins',
  effectiveValue: 'Effective value',
  currentChoice: 'Current choice',
  inherits: 'Inherits the platform value.',
  explicitEmpty: 'Explicit empty (stops inheritance).',
  managedByPlatform: 'Managed by the platform.',
  modeLegend: 'Mode',
  modeInherit: 'Inherit',
  modeEmpty: 'Explicit empty',
  modeValue: 'Value',
  valueLabel: 'Value',
  saveSetting: 'Save',
  settingSaved: 'Saved.',
  settingFailed: 'Saving this setting did not work. Try again.',
  adminIdLabel: 'Admin ID',
  adminIdHelp: 'Opaque admin identifier. No member names or membership details are shown here.',
  addAdmin: 'Add admin',
  removeAdmin: 'Remove',
  emptyAdminId: 'Enter an admin ID first.',
  adminFailed: 'Updating this admin did not work. Try again.',
  noAdmins: 'No admins for this community.',
  noSettings: 'No settings for this community.',
} as const;

export type RootStrings = typeof rootStrings;
