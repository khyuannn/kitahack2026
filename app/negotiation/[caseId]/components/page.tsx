"use client";

import { useCaseMessages, CaseMessage } from "@/hooks/useCaseMessages";
import { useState, useEffect, useDebugValue } from "react";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "@/firebase/config";
import SettlementMeter from "@/components/settlementMeter"; // adjust path if needed
import StrategyConsole from "@/components/StrategyConsole";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { auth } from "@/firebase/config";
import { runTransaction } from "firebase/firestore";
import { useParams } from "next/navigation";


export default function NegotiationPage() {
  const params = useParams();
  const caseId = params.caseId as string;
  const { messages, loading } = useCaseMessages(caseId);
  const [meter, setMeter] = useState(0);
  const [currentTurn, setCurrentTurn] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<"plaintiff" | "defendant" | null>(null);

  const isMyTurn = currentTurn === userRole;
  const handleSend = async (message: string) => {
  if (!caseId) return;

  if (!userRole || !isMyTurn) return;


  try {
    // 1️⃣ Add message
    await addDoc(collection(db, "cases", caseId, "messages"), {
      content: message,
      role: userRole,
      createdAt: serverTimestamp(),
    });

    // 2️⃣ Switch turn
    const nextTurn =
      userRole === "plaintiff" ? "defendant" : "plaintiff";

    await updateDoc(doc(db, "cases", caseId), {
      "game_state.current_turn": nextTurn,
    });

  } catch (error) {
    console.error("Error sending message:", error);
  }
};

  useEffect(() => {
    if (!caseId) return; // safety check

    const unsub = onSnapshot(doc(db, "cases", caseId), (docSnap) => {
      const data = docSnap.data();
      setCurrentTurn(data?.game_state?.current_turn ?? null);
      setMeter(data?.game_state?.settlement_meter ?? 0);
    });

    return () => unsub(); // cleanup on unmount
  }, [caseId]);

useEffect(() => {
  const assignRole = async () => {
    if (!caseId) return;

    const user = auth.currentUser;
    if (!user) return;

    const caseRef = doc(db, "cases", caseId);

    await runTransaction(db, async (transaction) => {
      const caseSnap = await transaction.get(caseRef);
      if (!caseSnap.exists()) return;

      const data = caseSnap.data();
      if (!data.participants) return;
      const participants = data.participants;


      // If creator
      if (participants.plaintiff_uid === user.uid) {
        setUserRole("plaintiff");
        return;
      }

      // If defendant empty
      if (!participants.defendant_uid) {
        transaction.update(caseRef, {
          "participants.defendant_uid": user.uid,
        });
        setUserRole("defendant");
        return;
      }

      // If already defendant
      if (participants.defendant_uid === user.uid) {
        setUserRole("defendant");
        return;
      }

      // Third user
      alert("Case already has two participants.");
    });
  };

  assignRole();
}, [caseId]);



  // Error Prevention: Handle the "Loading" state
  if (loading) {
    return <div style={{ padding: 20 }}>Loading messages...</div>;
  }

  if (!userRole) {
  return <div style={{ padding: 20 }}>Assigning role...</div>;
}


return (
  <div style={{ padding: 20, paddingBottom: 120 }}>
    <h2>Case ID: {caseId}</h2>
    <h3>Settlement Progress</h3>
    <SettlementMeter value={meter} />

    <div
      style={{
        border: "1px solid #ccc",
        padding: 20,
        height: 400,
        overflowY: "scroll",
      }}
    >
      {!isMyTurn && ( <p style={{ color: "gray", marginTop: 5 }}> Waiting for opponent's turn... </p> )}
      {messages?.map((msg: CaseMessage) => (
        <div
          key={msg.id}
          style={{
            textAlign:
              msg.role === "plaintiff" ? "left" : "right",
            marginBottom: 10,
          }}
        >
          <strong>{msg.role}</strong>: {msg.content}
        </div>
      ))}
    </div>

    {/* Footer Console */}
    <StrategyConsole
      onSend={handleSend}
      disabled={!isMyTurn}
    />
  </div>
);

}
