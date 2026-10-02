// English strings for the profile editor view.
//
// This view owns its strings so a future translation can copy this file:
// keys stay stable, values change. No user-visible text for this package
// lives anywhere else.

export const profileStrings = {
  title: 'My profile',
  lead: 'There are no profile pictures. Every field has a validator; only rules use ranges.',
  formLabel: 'Edit profile',
  loading: 'Loading…',
  loadFailed: 'The profile could not be loaded.',
  publicHelp: 'Public: visible in discovery.',
  privateHelp: 'Private: shared only under your rules.',
  rulesTitle: 'Who can see the private side',
  rulesLead: "Both members must satisfy each other's rules before keys are released.",
  ruleAnyHelp: 'Leave empty for no rule on this field.',
  choicesRuleSuffix: '(allowed answers, comma separated)',
  minSuffix: '(minimum)',
  maxSuffix: '(maximum)',
  latitudeLabel: 'Latitude',
  longitudeLabel: 'Longitude',
  locationHelp: 'Enter latitude and longitude explicitly. No map lookup is used.',
  distanceSuffix: '(within km)',
  distanceHelp: 'Maximum distance in kilometres from your profile location.',
  previewTitle: 'Preview',
  previewFront: 'Front: public profile',
  previewBack: 'Back: private profile',
  save: 'Save profile',
  saving: 'Publishing…',
  publishedOk: 'Profile published and checked.',
  validationSummary: 'The profile is not complete yet.',
  saveFailed: 'Saving did not work. Try again.',
  statusDraft: 'Not yet published.',
  statusPublishedPrefix: 'Published, revision ',
  newProfileNote:
    'Answer the community questions in your own words. Required questions are marked.',
} as const;

export type ProfileStrings = typeof profileStrings;
