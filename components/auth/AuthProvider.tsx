"use client";
/** The signed-in user and their Likeness account (role, creator state, brand, demo credits). */
import { onAuthStateChanged, type User } from "firebase/auth";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, auth, firebaseConfigured } from "@/lib/client/firebase";
import type { Channel, Role, Terms } from "@/lib/model";

export type Me = {
  user: { uid: string; role: Role | null; name: string | null; email: string | null };
  creator: {
    uid: string;
    displayName: string;
    status: "draft" | "live";
    listed: boolean;
    demo: boolean;
    channel: Pick<Channel, "title" | "subscriberCount" | "connectedAt" | "channelId"> | null;
    faceMatch: { score: number; at: number } | null;
    faceMatched: boolean;
    adultSelfDeclared: boolean;
    terms: Terms | null;
    photo: string | null;
  } | null;
  brand: { name: string; website: string } | null;
  credits: number;
};

type Ctx = { user: User | null; me: Me | null; loading: boolean; configured: boolean; refresh: () => Promise<void> };
const C = createContext<Ctx>({ user: null, me: null, loading: true, configured: false, refresh: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = firebaseConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(configured);

  const refresh = useCallback(async () => {
    if (!auth().currentUser) return setMe(null);
    setMe(await api<Me>("/api/me"));
  }, []);

  useEffect(() => {
    if (!configured) return;
    return onAuthStateChanged(auth(), async (u) => {
      setUser(u);
      try {
        if (u) setMe(await api<Me>("/api/me"));
        else setMe(null);
      } finally {
        setLoading(false);
      }
    });
  }, [configured]);

  return <C.Provider value={{ user, me, loading, configured, refresh }}>{children}</C.Provider>;
}

export const useAuth = () => useContext(C);
