"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/firebase/config";
import { useCaseMessages } from "@/hooks/useCaseMessages";
import SettlementMeter from "@/app/components/settlementMeter";
import EvidenceModal from "@/app/components/EvidenceModal";

/* ── Types matching backend TurnResponse ── */
interface ChipOption {
  label: string;
  strategy_id?: string;
}
interface ChipOptions {
  question: string;
  options: ChipOption[];
}
interface TurnResponse {
  agent_message: string;
  audio_url: string | null;
  auditor_passed: boolean;
  auditor_warning: string | null;
  chips: ChipOptions | null;
  game_state: string;
  counter_offer_rm: number | null;
}
interface CaseData {
  title?: string;
  caseType?: string;
  amount?: number;
  floorPrice?: number;
  status?: string;
  game_state?: string;
  settlement?: any;
}

export default function NegotiationPage() {
  const params = useParams();
  const router = useRouter();
  const caseId = params.caseId as string;

  /* ── State ── */
  const [caseData, setCaseData] = useState<CaseData | null>(null);
  const [caseLoading, setCaseLoading] = useState(true);
  const { messages, loading: messagesLoading } = useCaseMessages(caseId);

  const [input, setInput] = useState("");
  const [currentRound, setCurrentRound] = useState(1);
  const [sending, setSending] = useState(false);
  const [chips, setChips] = useState<ChipOptions | null>(null);
  const [auditorWarning, setAuditorWarning] = useState<string | null>(null);
  const [gameState, setGameState] = useState("active");
  const [settlementValue, setSettlementValue] = useState(50);
  const [counterOffer, setCounterOffer] = useState<number | null>(null);
  const [evidenceUris, setEvidenceUris] = useState<string[]>([]);

  // Modals
  const [showEvidence, setShowEvidence] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);

  // Settlement decision (round 4.5)
  const [showDecision, setShowDecision] = useState(false);
  const [decidingAccept, setDecidingAccept] = useState(false);
  const [decidingReject, setDecidingReject] = useState(false);

  const chatBoxRef = useRef<HTMLDivElement>(null);

  /* ── Load case data (real-time) ── */
  useEffect(() => {
    if (!caseId) return;
    const unsub = onSnapshot(doc(db, "cases", caseId), (snap) => {
      if (snap.exists()) {
        setCaseData(snap.data() as CaseData);
      }
      setCaseLoading(false);
    });
    return () => unsub();
  }, [caseId]);

  /* ── Derive round from messages ── */
  useEffect(() => {
    if (messages.length > 0) {
      const maxRound = Math.max(...messages.map((m) => m.round || 1));
      setCurrentRound(maxRound);
    }
  }, [messages]);

  /* ── Auto-scroll ── */
  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTo({
        top: chatBoxRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages, auditorWarning, showDecision]);

  /* ── Handle game_state changes ── */
  useEffect(() => {
    if (gameState === "pending_decision") {
      setShowDecision(true);
    }
  }, [gameState]);

  /* ── Send message (calls /api/cases/{caseId}/next-turn) ── */
  const handleSend = useCallback(
    async (message: string) => {
      if (!message.trim() || sending) return;
      setSending(true);
      setAuditorWarning(null);
      setChips(null);

      try {
        const res = await fetch(`/api/cases/${caseId}/next-turn`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            caseId,
            user_message: message.trim(),
            current_round: currentRound,
            evidence_uris: evidenceUris,
            floor_price: caseData?.floorPrice ?? null,
          }),
        });

        if (!res.ok) {
          const text = await res.text();
          let detail = `Turn failed (HTTP ${res.status})`;
          try {
            const err = JSON.parse(text);
            detail = err.detail || detail;
          } catch {
            detail = text || detail;
          }
          console.error("Turn error response:", res.status, detail);
          throw new Error(detail);
        }

        const data: TurnResponse = await res.json();

        // Update state from response
        setGameState(data.game_state);
        if (data.chips) setChips(data.chips);
        if (data.counter_offer_rm != null) setCounterOffer(data.counter_offer_rm);
        if (!data.auditor_passed && data.auditor_warning) {
          setAuditorWarning(data.auditor_warning);
        }

        // Update settlement meter based on counter offer vs dispute amount
        if (data.counter_offer_rm != null && caseData?.amount) {
          const ratio = (data.counter_offer_rm / caseData.amount) * 100;
          setSettlementValue(Math.min(100, Math.max(0, ratio)));
        }

        // Advance round
        setCurrentRound((r) => r + 1);
      } catch (error: any) {
        console.error("Turn error:", error);
        alert(error.message || "Failed to send message");
      } finally {
        setSending(false);
        setInput("");
      }
    },
    [caseId, currentRound, evidenceUris, caseData, sending]
  );

  /* ── Accept / Reject offer ── */
  const handleAcceptOffer = async () => {
    setDecidingAccept(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/accept-offer`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Accept failed");
      setGameState("settled");
      setShowDecision(false);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setDecidingAccept(false);
    }
  };

  const handleRejectOffer = async () => {
    setDecidingReject(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/reject-offer`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Reject failed");
      setGameState("deadlock");
      setShowDecision(false);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setDecidingReject(false);
    }
  };

  /* ── Export court filing ── */
  const handleExportFiling = async () => {
    try {
      const res = await fetch(`/api/cases/${caseId}/export-pdf`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Export failed");
      const data = await res.json();
      // Open in new window for printing
      const printWindow = window.open("", "_blank");
      if (printWindow) {
        printWindow.document.write(`
          <html><head><title>Court Filing - ${caseId}</title>
          <style>body{font-family:serif;max-width:700px;margin:40px auto;padding:20px;line-height:1.6}
          h1{text-align:center}h2{border-bottom:1px solid #000;padding-bottom:4px}
          .field{margin:8px 0}.label{font-weight:bold}</style></head><body>
          <h1>BORANG 198 - Small Claims Court</h1>
          <h2>Plaintiff</h2><p>${data.plaintiff_details}</p>
          <h2>Defendant</h2><p>${data.defendant_details}</p>
          <h2>Statement of Claim</h2><p>${data.statement_of_claim}</p>
          <h2>Amount Claimed</h2><p>${data.amount_claimed}</p>
          <h2>Facts</h2><ul>${(data.facts_list || []).map((f: string) => `<li>${f}</li>`).join("")}</ul>
          <h2>Negotiation Summary</h2><p>${data.negotiation_summary}</p>
          </body></html>
        `);
        printWindow.document.close();
      }
    } catch (err: any) {
      alert(err.message || "Failed to export filing");
    }
  };

  /* ── Evidence validated callback ── */
  const handleEvidenceValidated = (fileUri: string, fileName: string, fileType: string) => {
    setEvidenceUris((prev) => [...prev, fileUri]);
  };

  /* ── Invite link ── */
  const handleCopyInvite = async () => {
    const link = `${window.location.origin}/negotiation/${caseId}`;
    await navigator.clipboard.writeText(link);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  };

  /* ── Loading state ── */
  if (caseLoading || messagesLoading) {
    return (
      <div className="bg-off-white min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <span className="material-icons text-4xl text-gray-300 animate-pulse">balance</span>
          <p className="text-sm text-gray-400 font-medium">Loading negotiation...</p>
        </div>
      </div>
    );
  }

  const isActive = gameState === "active";
  const isSettled = gameState === "settled";
  const isDeadlock = gameState === "deadlock";

  return (
    <div className="bg-off-white min-h-screen font-sans antialiased text-gray-900 flex justify-center">
      <div className="w-full max-w-md bg-white min-h-screen shadow-2xl relative flex flex-col">
        {/* ── Header ── */}
        <header className="px-5 py-4 border-b border-gray-100 flex items-center gap-3 bg-white sticky top-0 z-20">
          <button
            onClick={() => router.push("/dashboard")}
            className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center hover:bg-gray-100 transition-colors"
          >
            <span className="material-icons text-lg text-gray-600">arrow_back</span>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-lg font-bold text-black truncate">
              {caseData?.title || "Negotiation"}
            </h1>
            <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">
              Round {currentRound} &middot;{" "}
              {isSettled ? "Settled" : isDeadlock ? "Deadlock" : "Active"}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowEvidence(true)}
              className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center hover:bg-gray-100 transition-colors"
              title="Upload Evidence"
            >
              <span className="material-icons text-lg text-gray-600">attach_file</span>
            </button>
            <button
              onClick={handleCopyInvite}
              className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center hover:bg-gray-100 transition-colors"
              title="Copy invite link"
            >
              <span className="material-icons text-lg text-gray-600">
                {inviteCopied ? "check" : "share"}
              </span>
            </button>
          </div>
        </header>

        {/* ── Settlement Meter ── */}
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
              Settlement Progress
            </span>
            {counterOffer != null && (
              <span className="text-[10px] font-bold text-gray-700">
                Counter: RM {counterOffer.toLocaleString()}
              </span>
            )}
          </div>
          <SettlementMeter value={settlementValue} />
        </div>

        {/* ── Chat Messages ── */}
        <div ref={chatBoxRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-12">
              <span className="material-icons text-5xl text-gray-200 mb-3 block">forum</span>
              <p className="text-sm text-gray-400">
                Start by describing your position below
              </p>
            </div>
          )}

          {messages.map((msg) => {
            const isUser = msg.role === "plaintiff" || msg.role === "user";
            return (
              <div key={msg.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                    isUser
                      ? "bg-[#1a2a3a] text-white rounded-br-md"
                      : msg.role === "mediator"
                      ? "bg-amber-50 text-amber-900 border border-amber-200 rounded-bl-md"
                      : "bg-gray-100 text-gray-900 rounded-bl-md"
                  }`}
                >
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1 opacity-60">
                    {msg.role === "plaintiff"
                      ? "You"
                      : msg.role === "defendant"
                      ? "Opponent"
                      : msg.role === "mediator"
                      ? "Mediator"
                      : msg.role}
                  </p>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  {msg.round && (
                    <p className="text-[9px] mt-1.5 opacity-40">Round {msg.round}</p>
                  )}
                </div>
              </div>
            );
          })}

          {/* Sending indicator */}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-2xl rounded-bl-md px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-wider mb-1 text-gray-400">
                  Opponent
                </p>
                <div className="flex gap-1.5 items-center py-1">
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Auditor Warning Bar ── */}
        {auditorWarning && (
          <div className="px-5 py-3 bg-yellow-50 border-t border-yellow-200 flex items-start gap-2">
            <span className="material-icons text-yellow-600 text-lg shrink-0 mt-0.5">warning</span>
            <div className="flex-1">
              <p className="text-[10px] font-bold text-yellow-800 uppercase tracking-wider mb-0.5">
                Auditor Warning
              </p>
              <p className="text-xs text-yellow-700 leading-relaxed">{auditorWarning}</p>
            </div>
            <button
              onClick={() => setAuditorWarning(null)}
              className="text-yellow-500 hover:text-yellow-700"
            >
              <span className="material-icons text-sm">close</span>
            </button>
          </div>
        )}

        {/* ── Pending Decision (Accept/Reject) ── */}
        {showDecision && (
          <div className="px-5 py-4 bg-blue-50 border-t border-blue-200">
            <p className="text-xs font-bold text-blue-900 mb-1">Final Offer on the Table</p>
            {counterOffer != null && (
              <p className="text-lg font-bold text-blue-800 mb-3">
                RM {counterOffer.toLocaleString()}
              </p>
            )}
            <div className="flex gap-3">
              <button
                onClick={handleAcceptOffer}
                disabled={decidingAccept}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50"
              >
                {decidingAccept ? "Accepting..." : "Accept Offer"}
              </button>
              <button
                onClick={handleRejectOffer}
                disabled={decidingReject}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50"
              >
                {decidingReject ? "Rejecting..." : "Reject & Go to Court"}
              </button>
            </div>
          </div>
        )}

        {/* ── Settled Banner ── */}
        {isSettled && (
          <div className="px-5 py-4 bg-green-50 border-t border-green-200 text-center">
            <span className="material-icons text-green-600 text-2xl mb-1">handshake</span>
            <p className="text-sm font-bold text-green-800">Settlement Reached</p>
            <p className="text-xs text-green-600 mt-1">
              Both parties have agreed to a resolution.
            </p>
          </div>
        )}

        {/* ── Deadlock Banner ── */}
        {isDeadlock && (
          <div className="px-5 py-4 bg-red-50 border-t border-red-200 text-center">
            <span className="material-icons text-red-600 text-2xl mb-1">gavel</span>
            <p className="text-sm font-bold text-red-800">Negotiation Deadlock</p>
            <p className="text-xs text-red-600 mt-1 mb-3">
              Unable to reach agreement. You can export a court filing form.
            </p>
            <button
              onClick={handleExportFiling}
              className="bg-[#1a2a3a] text-white font-semibold py-2.5 px-6 rounded-lg text-sm hover:bg-[#243447] transition-colors"
            >
              Export Court Filing (Form 198)
            </button>
          </div>
        )}

        {/* ── Chips ── */}
        {chips && isActive && !sending && (
          <div className="px-5 py-3 bg-gray-50 border-t border-gray-100">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
              {chips.question}
            </p>
            <div className="flex flex-wrap gap-2">
              {chips.options.map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => handleSend(opt.label)}
                  className="bg-white border border-gray-200 text-gray-800 text-xs font-medium px-3 py-2 rounded-full hover:bg-[#1a2a3a] hover:text-white hover:border-[#1a2a3a] transition-all"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Input Bar ── */}
        {isActive && (
          <div className="px-4 py-3 border-t border-gray-100 bg-white sticky bottom-0">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend(input);
                  }
                }}
                placeholder="State your position..."
                disabled={sending}
                className="flex-1 bg-gray-50 border border-gray-200 rounded-full px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a2a3a]/20 focus:border-[#1a2a3a] placeholder:text-gray-400 disabled:opacity-50"
              />
              <button
                onClick={() => handleSend(input)}
                disabled={sending || !input.trim()}
                className="w-11 h-11 bg-[#1a2a3a] text-white rounded-full flex items-center justify-center hover:bg-[#243447] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                <span className="material-icons text-lg">
                  {sending ? "hourglass_empty" : "send"}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* ── Evidence Modal ── */}
        <EvidenceModal
          isOpen={showEvidence}
          onClose={() => setShowEvidence(false)}
          onValidated={handleEvidenceValidated}
          caseId={caseId}
        />
      </div>
    </div>
  );
}
