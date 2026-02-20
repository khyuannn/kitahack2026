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

export function useCaseMessages(caseId: string) {
  const [messages, setMessages] = useState<CaseMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!caseId) return;

    const q = query(
      collection(db, "cases", caseId, "messages"),
      orderBy("createdAt", "asc")
    );

    const unsub = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as CaseMessage[];

      setMessages(data);
      setLoading(false);
    });

    return () => unsub();
  }, [caseId]);

  return { messages, loading };
}
