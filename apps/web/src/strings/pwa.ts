// English strings for the install prompt and the offline shell notice.
// Views copy this file for future translations; no logic lives here.

export const pwaStrings = {
  installTitle: 'Install cmeet',
  installLead: 'Add cmeet to your home screen for a full-screen start.',
  installAction: 'Install',
  installingAction: 'Waiting for the device…',
  helpSummary: 'Add to Home Screen',
  iphoneTitle: 'iPhone and iPad (Safari)',
  iphoneSteps: [
    'Open cmeet in Safari.',
    'Tap the Share button in the toolbar.',
    'Choose Add to Home Screen.',
    'Confirm with Add.',
  ],
  androidTitle: 'Android (browser menu)',
  androidSteps: [
    'Open cmeet in your browser.',
    'Open the browser menu.',
    'Choose Add to Home screen or Install.',
    'Confirm the prompt.',
  ],
  iosNote:
    'When no Install button is available, use the Share steps in Safari above.',
  offlineLimited: 'Offline availability is limited on this device.',
} as const;

export type PwaStrings = typeof pwaStrings;
