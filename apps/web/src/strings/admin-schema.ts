// English strings for the admin schema editor. Views take these labels as
// props where it matters so no user-visible text is hard-coded in the view.
// Translators copy this file: keys stay stable, values change.

export const adminSchemaStrings = {
  title: 'Profile schema',
  lead: 'Edit community profile questions. Saved changes can affect existing profiles. Review the reported impact after saving.',
  signIn: 'Sign in as admin',
  signingIn: 'Signing in…',
  signInHelp: 'Admin actions need a fresh admin sign-in with your passkey.',
  questionsHeading: 'Profile questions',
  reorderHelp: 'Drag questions to order them, or use the move buttons. The preview always shows the member view: public front, private back.',
  questionLabel: 'Question text',
  answerStyleLabel: 'Answer style',
  answerStyles: ['choice', 'number', 'yes-no', 'location', 'short-text', 'long-text'] as const,
  visibilityLabel: 'Visibility',
  visibilityChoices: ['public', 'private'] as const,
  choicesLabel: 'Choices (comma separated)',
  choicesHelp: 'Only for choice questions. Separate answers with commas.',
  minLabel: 'Minimum value',
  maxLabel: 'Maximum value',
  boundsHelp: 'Only for number questions. Leave empty for no bound.',
  requiredLabel: 'Required',
  filterableLabel: 'Usable as a filter',
  removeLabel: 'Remove question',
  addLabel: 'Add question',
  newQuestionDefault: 'New question',
  moveUpLabel: 'Move up',
  moveDownLabel: 'Move down',
  save: 'Save schema',
  saving: 'Saving…',
  preview: 'Live preview',
  sampleHeading: 'Sample answers (not saved)',
  sampleHelp: 'Type sample answers to check the member preview. Nothing here is saved; the preview starts empty.',
  samplePlaceholder: 'Type a sample answer',
  impact: (note: string, profilesNeedingChanges: number, grandfathered: number) =>
    `${note} Profiles needing changes: ${profilesNeedingChanges}. Grandfathered: ${grandfathered}.`,
  loading: 'Loading…',
  loadFailed: 'The schema could not be loaded.',
  saveFailed: 'Saving the schema did not work.',
  retry: 'Try again',
  frontLabel: 'Front: public profile',
  backLabel: 'Back: private profile',
} as const;

export type AdminSchemaStrings = typeof adminSchemaStrings;
