
export type Contact = {
  id: string;
  userId: string;
  name: string;
  firstName?: string;
  role?: string;
  tags: string[];
  summary: string;
  lastInteraction: string;
  interactionScore: number;
  birthday?: string;
  avatarUrl?: string;
  createdAt: string;
  telegram?: string;
  phone?: string;
  email?: string;
  linkedin?: string;
  isFavorite?: boolean;
  /** Legacy single float vector (pre-v3); superseded by `vecs`. */
  embedding?: number[];
  /** Base64-packed int8 multi-vectors for semantic search; computed lazily (see vector.ts) */
  vecs?: string[];
  /** Scheme version of the stored vectors; stale versions are recomputed (see EMBEDDING_VERSION) */
  embeddingVersion?: number;
};

export type InteractionEvent = {
  id: string;
  contactId: string;
  date: string;
  type: string;
  summary: string;
  createdAt?: any;
};

export type UserProfile = {
  id: string;
  name: string;
  avatarUrl: string;
  totalContacts: number;
  lastActive: string;
  language: string;
  theme: string;
  birthdayReminders?: boolean;
  staleReminders?: boolean;
};
