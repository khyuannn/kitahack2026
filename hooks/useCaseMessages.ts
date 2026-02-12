"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { db } from "@/firebase/config";

export interface CaseMessage {
  id: string;
  role: string;
  content: string;
}

export function useCaseMessages(caseId: string) {
  const [messages, setMessages] = useState<CaseMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!caseId) return;

    // Use onSnapshot for real-time updates
    const q = query(
      collection(db, "cases", caseId, "messages"),
      orderBy("createdAt", "asc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as CaseMessage[];

      setMessages(data);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [caseId]);

  return { messages, loading };
}
