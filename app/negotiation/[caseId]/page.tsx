"use client";

import { useCaseMessages, CaseMessage } from "@/hooks/useCaseMessages";
import { useState, useEffect, useDebugValue } from "react";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "@/firebase/config";
import SettlementMeter from "@/components/settlementMeter"; // adjust path if needed
import { useParams, useSearchParams } from "next/navigation";
import { getDoc } from "firebase/firestore";
import StrategyConsole from "@/components/StrategyConsole";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";



export default function NegotiationPage() {
  const params = useParams();
  const caseId = params.caseId as string;
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const { messages, loading } = useCaseMessages(caseId);
  const [meter, setMeter] = useState(0);
  const [currentTurn, setCurrentTurn] = useState<string | null>(null);
  const userRole = token ? "defendant" : "plaintiff";
  const isMyTurn = currentTurn?.toLowerCase() === userRole.toLowerCase();
  const [newMessage, setNewMessage] = useState("");

  const handleSend = async (message: string) => {
  if (!caseId) return;

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
    if (!token || !caseId) return;
    const validateInvite = async () => {
      try {
        const inviteRef = doc(db, "invites", token);
        const inviteSnap = await getDoc(inviteRef);
        if (!inviteSnap.exists()) {
          throw new Error("Invite not found");
        }
        const data = inviteSnap.data();
        if (data.caseId !== caseId) {
          alert("invalid invite for this case");
          return; // Ensure token matches the case
        }
        if (data.expiresAt < Date.now()) {
          alert("invite expired");
          return; // Check expiry
        }

        if (data.used) {
          alert("Invite already used.");
          return;
        }

        await updateDoc(inviteRef, {
          used: true,
          defendant_joined: true
        });

      } catch (error) {
        console.error("Failed to validate invite:", error);
      }

    };

    validateInvite();
  }, [token, caseId]);



  // Error Prevention: Handle the "Loading" state
  if (loading) {
    return <div style={{ padding: 20 }}>Loading messages...</div>;
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
