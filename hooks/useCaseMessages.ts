"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../firebase/config";

export interface CaseMessage {
  id: string;
  role: string;
  content: string;
  round?: number;
  counter_offer_rm?: number | null;
  audio_url?: string | null;
  auditor_passed?: boolean;
  auditor_warning?: string | null;
  createdAt?: any;
}

export function useCaseMessages(caseId: string, enabled: boolean = true) {
  const [messages, setMessages] = useState<CaseMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!caseId || !enabled) {
      setLoading(!enabled ? true : false);
      return;
    }

    const q = query(
      collection(db, "cases", caseId, "messages"),
      orderBy("createdAt", "asc")
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as CaseMessage[];

        setMessages(data);
        setLoading(false);
        if (retryCount > 0) setRetryCount(0);
      },
      (error) => {
        console.error("Failed to subscribe case messages:", error);
        if (retryCount < 3) {
          console.warn(`Retrying case messages subscription (attempt ${retryCount + 1}/3)...`);
          setTimeout(() => setRetryCount((r) => r + 1), 2000 * (retryCount + 1));
        } else {
          setLoading(false);
        }
      }
    );

    return () => unsub();
  }, [caseId, enabled, retryCount]);

  return { messages, loading };
}
