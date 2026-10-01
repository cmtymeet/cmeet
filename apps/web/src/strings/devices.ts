export const devicesStrings = {
  title: 'Devices', lead: 'Keep another device available. Every enrolled passkey works equally; none is a master passkey.',
  loss: 'If every device and network copy is lost, your identity and data cannot be recovered. There is no operator recovery.',
  loading: 'Loading devices…', empty: 'No devices are available.', retry: 'Try again',
  name: 'Device name', add: 'Add a device', pending: 'Waiting for approval', active: 'Active', current: '(this device)',
  added: 'Pairing requested. Review and approve the waiting device separately.', approve: 'Review pairing', remove: 'Remove', rename: 'Rename', save: 'Save name', cancel: 'Cancel',
  pairingTitle: 'Approve this device?', pairingHelp: 'Approve only the device you are pairing. Approval lets it access your membership and content.',
  removeTitle: 'Remove this device?', removeHelp: 'This revokes future access. Copies already held by that device cannot be erased remotely.',
  confirmApprove: 'Approve device', confirmRemove: 'Remove device', restore: 'Restore from surviving copies',
  restoreTitle: 'Recovery result', failed: 'The request could not be completed. Try again.',
  restoreStates: { ready: 'Recoverable copy available', locked: 'Passkey sign-in needed', unavailable: 'Copies unavailable', unrecoverable: 'Recovery impossible' },
} as const;
