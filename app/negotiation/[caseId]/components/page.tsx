"use client";

import React, { useState, useEffect } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/firebase/config";
import { useAuth } from "@/hooks/useAuth";

interface CourtFormData {
  plaintiff_name: string;
  defendant_name: string;
  claim_amount: number;
  details: string;
}

export default function DeadlockScreen({ caseId }: { caseId: string }) {
  const { loading: authLoading, uid } = useAuth();
  const [isDeadlock, setIsDeadlock] = useState(false);
  const [pdfData, setPdfData] = useState<CourtFormData | null>(null);
  const [loading, setLoading] = useState(false);
  const [deadlockRetryCount, setDeadlockRetryCount] = useState(0);

  // Listen to game_state changes
  useEffect(() => {
    if (!uid) return;

    const unsub = onSnapshot(
      doc(db, "cases", caseId),
      (docSnap) => {
        const data = docSnap.data();
        setIsDeadlock(data?.game_state?.status === "deadlock");
        if (deadlockRetryCount > 0) setDeadlockRetryCount(0);
      },
      (error) => {
        console.error("Failed to subscribe deadlock state:", error);
        if (deadlockRetryCount < 3) {
          console.warn(`Retrying deadlock subscription (attempt ${deadlockRetryCount + 1}/3)...`);
          setTimeout(() => setDeadlockRetryCount((r) => r + 1), 2000 * (deadlockRetryCount + 1));
        }
      }
    );

    return () => unsub();
  }, [caseId, uid, deadlockRetryCount]);

    const handleExport = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/cases/${caseId}/export-pdf`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to fetch court form");
      const json = await res.json();
      setPdfData(json);
    } catch (error) {
      console.error(error);
      alert("Failed to export small claims form.");
    } finally {
      setLoading(false);
    }
  };

    if (!isDeadlock) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-2xl">
        <h1 className="text-3xl font-bold text-red-600 mb-4">
          Negotiation Failed
        </h1>

        {!pdfData ? (
          <button
            onClick={handleExport}
            disabled={loading}
            className="px-6 py-3 bg-black text-white rounded"
          >
            {loading ? "Generating..." : "Export Small Claims Form"}
          </button>

        ) : (
          <div className="space-y-4">
            {/* Render clean HTML court form */}
            <div className="border p-4">
              <h2 className="text-xl font-bold">Small Claims Form</h2>
              <p><strong>Case ID:</strong> {caseId}</p>
              <p><strong>Plaintiff:</strong> {pdfData.plaintiff_name}</p>
              <p><strong>Defendant:</strong> {pdfData.defendant_name}</p>
              <p><strong>Claim Amount:</strong> ${pdfData.claim_amount.toFixed(2)}</p>
              <p><strong>Details:</strong> {pdfData.details}</p>
            </div>

            <button
              onClick={() => window.print()}
              className="px-6 py-3 bg-green-600 text-white rounded"
            >
              Print Official Copy
            </button>

            <div
              className="fixed inset-0 flex items-center justify-center bg-black/50 z-50 p-4"
              onClick={() => setPdfData(null)} // or a separate onClose callback
            >
              <div
                className="bg-white rounded-lg shadow-lg p-6 w-full max-w-2xl"
                onClick={(e) => e.stopPropagation()} // prevent closing when clicking inside
              >
                ...
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
