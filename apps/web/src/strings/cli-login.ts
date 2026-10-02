// English text for the page that "cmeet login" opens.
export const cliLoginStrings = {
  title: 'Sign in from the command line',
  unavailable: 'Command-line sign-in is not available yet in this build.',
  checking: 'Checking the sign-in request…',
  community: 'Community',
  handoff: 'The result goes only to',
  noServers: 'Nothing is sent through our servers. Your passkey stays on your devices.',
  begin: 'Continue with my passkey',
  beginBusy: 'Waiting for your passkey…',
  cancel: 'Cancel',
  retry: 'Try again',
  done: 'Done. You can return to your terminal.',
  cancelled: 'The sign-in was cancelled.',
  failed: 'The sign-in did not complete.',
  closeNote: 'You can close this tab.',
  refusal: {
    malformed: 'This sign-in link is not valid. Start again with cmeet login.',
    'origin-mismatch': 'This link belongs to a different community address. Nothing was started.',
    expired: 'This sign-in request has expired. Start again with cmeet login.',
    replayed: 'This sign-in link was already used. Start again with cmeet login.',
    unavailable: 'Command-line sign-in is not available right now.',
  },
} as const;
