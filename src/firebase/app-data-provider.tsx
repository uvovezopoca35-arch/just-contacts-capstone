'use client';

/**
 * Subscribes ONCE to the user's contacts collection and profile document and
 * shares them via context. Because this provider lives in the root layout it
 * stays mounted across tab navigation, so the Firestore listeners stay warm and
 * pages read the data from memory instantly — no per-tab refetch / pop-in.
 */

import { createContext, useContext, ReactNode } from 'react';
import { collection, doc } from 'firebase/firestore';
import { useUser, useFirestore, useMemoFirebase } from './provider';
import { useCollection } from './firestore/use-collection';
import { useDoc } from './firestore/use-doc';
import type { Contact, UserProfile } from '@/lib/types';

interface AppDataValue {
  contacts: Contact[];
  contactsLoading: boolean;
  profile: UserProfile | null;
  profileLoading: boolean;
}

const AppDataContext = createContext<AppDataValue>({
  contacts: [],
  contactsLoading: true,
  profile: null,
  profileLoading: true,
});

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const firestore = useFirestore();

  const contactsQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return collection(firestore, 'users', user.uid, 'contacts');
  }, [firestore, user]);
  const { data: contacts } = useCollection<Contact>(contactsQuery);

  const userRef = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return doc(firestore, 'users', user.uid);
  }, [firestore, user]);
  const { data: profile, isLoading: profileLoading } = useDoc<UserProfile>(userRef);

  return (
    <AppDataContext.Provider
      value={{
        contacts: contacts ?? [],
        contactsLoading: contacts === null,
        profile: profile ?? null,
        profileLoading: profile === null && profileLoading,
      }}
    >
      {children}
    </AppDataContext.Provider>
  );
}

/** Shared, always-warm contacts + profile for the signed-in user. */
export function useContacts() {
  return useContext(AppDataContext);
}
