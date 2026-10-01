// White-label community configuration. One deployment per community picks
// its name and theme here; components and logic stay untouched.

export interface CommunityConfig {
  communityId: string;
  displayName: string;
  /** Theme stylesheet under /themes (a white-label token override). */
  theme: 'default' | 'forest' | 'harbour';
}

export const community: CommunityConfig = {
  communityId: 'garden-neighbours',
  displayName: 'Garden neighbours',
  theme: 'default',
};
