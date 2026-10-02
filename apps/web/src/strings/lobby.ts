// Lobby journey strings (English first).
//
// Views import these labels so no user-visible lobby text is hard-coded in
// the component. Translators copy this file: keys stay stable, values change.

export const lobbyStrings = {
  title: 'Lobby',
  lead: 'Complete the remaining requirements in any order.',
  handleLabel: 'Handle',
  activeRequirements: 'Active requirements',
  resumeNote: 'Your progress appears below. Return here to continue unfinished steps.',
  noGates: 'Nothing is waiting for you right now.',
  complete: 'Complete',
  actionNeeded: 'Action needed',
  waiting: 'Waiting',
  codeLabel: 'Code',
  completeStep: 'Complete step',
  working: 'Working…',
  refusedFallback: 'That step was refused. Check the code and try again.',
  retry: 'Try again',
  loadFailedFallback: 'The lobby is unavailable right now.',
  profileHeading: 'Profile',
  profileIncompleteNote: 'Answer the community questions to introduce yourself.',
  completeProfile: 'Complete profile',
  devices: 'Devices',
  thisDevice: '(this device)',
  manageDevices: 'Manage devices',
  syncedPasskey:
    'Protect your synced passkey and keep another device available. Every enrolled passkey works equally. Losing all device and network copies means losing your identity and data.',
  enter: 'Enter forum when admitted',
  notAdmittedNote: 'Nobody enters the forum until admission succeeds.',
  loading: 'Loading…',
};

export type LobbyStrings = typeof lobbyStrings;
