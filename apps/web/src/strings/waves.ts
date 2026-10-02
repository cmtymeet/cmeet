export const wavesStrings = {
  title: 'First contact', lead: 'A reply starts a conversation. Delivery alone is not an answer.',
  slots: (outgoing: number, incoming: number) => `Introductions available: ${outgoing}. Incoming slots: ${incoming}.`,
  loading: 'Loading introductions…', empty: 'No waves waiting', emptyHint: 'New introductions appear here while you are online.',
  reply: 'Your reply', replyRequired: 'Write a reply before answering.', check: 'Check again',
  failed: 'That did not work. Try again.', answer: 'Answer', close: 'Respectfully close',
} as const;
