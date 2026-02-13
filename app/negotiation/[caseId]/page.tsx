"use client";

import { useCaseMessages, CaseMessage } from "@/hooks/useCaseMessages";
import { useState, useEffect, useDebugValue } from "react";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "@/firebase/config";
import SettlementMeter from "@/components/settlementMeter"; // adjust path if needed
import { useParams, useSearchParams } from "next/navigation";
import { getDoc } from "firebase/firestore";


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
    <div style={{ padding: 20 }}>
      <h2>Case ID: {caseId}</h2>
      <h3>Settlement Progress</h3>
      <SettlementMeter value={meter} />

      <input
    type="text"
    value={newMessage}
    onChange={(e) => setNewMessage(e.target.value)}
    placeholder="Type your message..."
    style={{ padding: 8, width: "70%", marginRight: 10 }}
  />

  <button
    disabled={!isMyTurn}
    style={{
      padding: 8,
      backgroundColor: isMyTurn ? "black" : "gray",
      color: "white",
      cursor: isMyTurn ? "pointer" : "not-allowed"
    }}
  >
    Send
  </button>

  {!isMyTurn && (
    <p style={{ color: "gray", marginTop: 5 }}>
      Waiting for opponent's turn...
    </p>
  )}
      <div
        style={{
          border: "1px solid #ccc",
          padding: 20,
          height: 400,
          overflowY: "scroll",
        }}
      >

        {messages?.map((msg: CaseMessage) => (
          <div key={msg.id} style={{ textAlign: msg.role === "plaintiff" ? "left" : "right", marginBottom: 10 }}>
            <strong>{msg.role}</strong>: {msg.content}
          </div>
        ))}

      </div>
    </div>


  );
}
