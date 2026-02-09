"use client";

import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
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

    const fetchMessages = async () => {
      const snapshot = await getDocs(
        collection(db, "cases", caseId, "messages")
      );

      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as CaseMessage[];

      setMessages(data);
      setLoading(false);
    };

    fetchMessages();
  }, [caseId]);

  return { messages, loading };
}
