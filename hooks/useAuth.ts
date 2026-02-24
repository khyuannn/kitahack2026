"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import {
  onAuthStateChanged,
  signInAnonymously as firebaseSignInAnonymously,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  linkWithPopup,
  User,
} from "firebase/auth";
import { auth } from "@/firebase/config";

interface AuthContextType {
  user: User | null;
  uid: string | null;
  isAnonymous: boolean;
  loading: boolean;
  displayName: string | null;
  signInWithGoogle: () => Promise<User | null>;
  signInWithEmailPassword: (email: string, password: string) => Promise<User | null>;
  signUpWithEmailPassword: (email: string, password: string) => Promise<User | null>;
  signInAnonymously: () => Promise<User | null>;
  upgradeAnonymousToGoogle: () => Promise<User | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  uid: null,
  isAnonymous: true,
  loading: true,
  displayName: null,
  signInWithGoogle: async () => null,
  signInWithEmailPassword: async () => null,
  signUpWithEmailPassword: async () => null,
  signInAnonymously: async () => null,
  upgradeAnonymousToGoogle: async () => null,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Ensure the ID token is fresh before exposing the user.
        // This prevents Firestore subscriptions from firing with a stale token.
        try {
          await firebaseUser.getIdToken();
        } catch {
          // Token refresh failed — user will be set anyway; sign-in flow can retry.
        }
      }
      setUser(firebaseUser);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const signInWithGoogle = useCallback(async (): Promise<User | null> => {
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      return result.user;
    } catch (error: any) {
      console.error("Google sign-in failed:", error);
      throw error;
    }
  }, []);

  const signInWithEmailPassword = useCallback(async (email: string, password: string): Promise<User | null> => {
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      return result.user;
    } catch (error: any) {
      console.error("Email/password sign-in failed:", error);
      throw error;
    }
  }, []);

  const signUpWithEmailPassword = useCallback(async (email: string, password: string): Promise<User | null> => {
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      return result.user;
    } catch (error: any) {
      console.error("Email/password sign-up failed:", error);
      throw error;
    }
  }, []);

  const signInAnon = useCallback(async (): Promise<User | null> => {
    try {
      const result = await firebaseSignInAnonymously(auth);
      return result.user;
    } catch (error: any) {
      console.error("Anonymous sign-in failed:", error);
      throw error;
    }
  }, []);

  const upgradeAnonymousToGoogle = useCallback(async (): Promise<User | null> => {
    if (!user || !user.isAnonymous) {
      // Already signed in with a provider — just do a normal Google sign-in
      return signInWithGoogle();
    }
    try {
      const provider = new GoogleAuthProvider();
      const result = await linkWithPopup(user, provider);
      return result.user;
    } catch (error: any) {
      // If linking fails (e.g., account already exists), fall back to normal sign-in
      if (error.code === "auth/credential-already-in-use" || error.code === "auth/email-already-in-use") {
        console.warn("Account already exists, signing in directly...");
        return signInWithGoogle();
      }
      console.error("Upgrade to Google failed:", error);
      throw error;
    }
  }, [user, signInWithGoogle]);

  const handleSignOut = useCallback(async () => {
    try {
      await auth.signOut();
    } catch (error) {
      console.error("Sign out failed:", error);
    }
  }, []);

  const value: AuthContextType = {
    user,
    uid: user?.uid ?? null,
    isAnonymous: user?.isAnonymous ?? true,
    loading,
    displayName: user?.displayName ?? null,
    signInWithGoogle,
    signInWithEmailPassword,
    signUpWithEmailPassword,
    signInAnonymously: signInAnon,
    upgradeAnonymousToGoogle,
    signOut: handleSignOut,
  };

  return React.createElement(AuthContext.Provider, { value }, children);
}

export function useAuth() {
  return useContext(AuthContext);
}
