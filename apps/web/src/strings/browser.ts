// English text for the browser separation: the vault frame, the sign-in
// pop-up and the status the member page shows. Status only, never key material.
export const browserStrings = {
  vaultTitle: 'Secure vault',
  vaultUnavailable: 'The secure vault is not available yet in this build.',
  vaultIdle: 'The vault is ready.',
  vaultAsk: 'Your passkey sign-in continues in a small window.',
  vaultContinue: 'Continue',
  vaultRetry: 'Try again',
  states: {
    idle: '',
    'continue-needed': 'Press Continue to open the passkey window.',
    'popup-open': 'Finish the sign-in in the passkey window.',
    done: 'Sign-in complete.',
    cancelled: 'The passkey window was closed before the sign-in finished.',
    blocked: 'Your browser blocked the passkey window. Allow pop-ups for this site and try again.',
    timeout: 'The sign-in took too long.',
    failed: 'The sign-in did not work.',
  },
  popupTitle: 'Confirm your sign-in',
  popupUnavailable: 'The passkey ceremony is not available yet in this build.',
  popupFixtureNote: 'Development fixture: this window approves nothing real.',
  popupApprove: 'Approve (fixture)',
  popupCancel: 'Cancel',
  popupMissing: 'This window was opened without a sign-in request.',
  // Member page status, shown outside the vault frame.
  memberStatus: {
    'continue-needed': 'Use the Continue button in the secure vault panel to open your passkey window.',
    'popup-open': 'Your passkey window is open. Finish there; this page never sees your passkey.',
    blocked: 'Your browser blocked the passkey window. Allow pop-ups and press Continue again.',
    cancelled: 'The passkey window was closed. Press Continue in the vault panel to try again.',
    timeout: 'The sign-in took too long. Try again.',
    failed: 'The sign-in did not work. Try again.',
    done: 'Passkey sign-in complete.',
    idle: '',
  },
} as const;
