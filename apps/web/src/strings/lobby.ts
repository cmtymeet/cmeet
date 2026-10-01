// Lobby journey strings (English first).
//
// Views import these labels so no user-visible lobby text is hard-coded in
// the component. Translators copy this file: keys stay stable, values change.

export const lobbyStrings = {
  title: 'Lobby',
  lead: 'Complete the remaining requirements in any order.',
  handleLabel: 'Handle',
  activeRequirements: 'Active requirements',
  resumeNote: 'You can leave and resume later. Only the steps below still need you.',
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
  profileIncompleteNote: 'Your profile is part of the same guided process and lives separately.',
  completeProfile: 'Complete profile',
  devices: 'Devices',
  thisDevice: '(this device)',
  manageDevices: 'Manage devices',
  syncedPasskey:
    'Protect access: use a synced passkey or another device. Losing all passkeys means no return.',
  enter: 'Enter forum when admitted',
  notAdmittedNote: 'Nobody enters the forum until admission succeeds.',
  loading: 'Loading…',
};

export type LobbyStrings = typeof lobbyStrings;
