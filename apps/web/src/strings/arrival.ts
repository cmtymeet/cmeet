// English strings for the community arrival (landing) view.
// Views use these labels so future translations copy this file only.

export const arrivalStrings = {
  tagline: 'Good conversations start with the right people.',
  startTitle: 'Welcome',
  startLead: 'One place to sign in or to register as a new member.',
  startAction: 'Sign in / register',
  optionsTitle: 'Sign in or register',
  returningTitle: 'Returning member',
  returningLead: 'Use your passkey on this device to sign in.',
  signInButton: 'Sign in with passkey',
  signInBusy: 'Waiting for passkey…',
  registerTitle: 'New member',
  registerLead: 'Use the invitation shared with you by a member.',
  voucherLabel: 'Invitation voucher',
  handleLabel: 'Choose a handle (8 to 32 characters)',
  continueAction: 'Continue to join',
  continueBusy: 'Checking voucher…',
  emptyVoucher: 'Enter your invitation voucher first.',
  emptyHandle: 'Choose a handle first.',
  joinFailed: 'Joining did not work. Try again.',
  signInFailed: 'Sign in did not work. Try again.',
} as const;

export type ArrivalStrings = typeof arrivalStrings;
