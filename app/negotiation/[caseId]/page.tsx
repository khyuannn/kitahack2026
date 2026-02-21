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
  plaintiff_message: string | null;
  current_round: number;
  audio_url: string | null;
  auditor_passed: boolean;
  auditor_warning: string | null;
  chips: ChipOptions | null;
  game_state: string;
  counter_offer_rm: number | null;
}

/* ── Default chips shown before first turn ── */
const DEFAULT_CHIPS: ChipOptions = {
  question: "How should your AI agent open the negotiation?",
  options: [
    { label: "Present Evidence First", strategy_id: "evidence_first" },
    { label: "Strong Legal Opening", strategy_id: "legal_opening" },
    { label: "Diplomatic Approach", strategy_id: "diplomatic" },
  ],
};
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
  const [progressStep, setProgressStep] = useState<string | null>(null);
  const [chips, setChips] = useState<ChipOptions | null>(DEFAULT_CHIPS);
  const [auditorWarning, setAuditorWarning] = useState<string | null>(null);
  const [gameState, setGameState] = useState("active");
  const [settlementValue, setSettlementValue] = useState(50);
  const [counterOffer, setCounterOffer] = useState<number | null>(null);
  const [evidenceUris, setEvidenceUris] = useState<string[]>([]);

  // Two-step chip flow: user selects a chip, then optionally types extra context
  const [selectedChip, setSelectedChip] = useState<string | null>(null);
  // Track whether mediator has appeared (for gating round-3 chips)
  const [mediatorShown, setMediatorShown] = useState(false);
  const [mediatorAutoTriggered, setMediatorAutoTriggered] = useState(false);

  // Modals
  const [showEvidence, setShowEvidence] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [elapsedSecs, setElapsedSecs] = useState(0);

  /* ── Elapsed time counter while sending ── */
  useEffect(() => {
    if (!sending) { setElapsedSecs(0); return; }
    const t = setInterval(() => setElapsedSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [sending]);

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

  /* ── Round is now derived from backend response, not messages ── */

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

  /* ── Track mediator appearance for chip gating ── */
  useEffect(() => {
    if (messages.some((m) => m.role === "mediator")) {
      setMediatorShown(true);
    }
  }, [messages]);

  /* ── Send directive (calls /api/cases/{caseId}/next-turn with streaming) ── */
  const handleSend = useCallback(
    async (message: string) => {
      if (sending) return;
      const directive = message?.trim() || "";
      setSending(true);
      setAuditorWarning(null);
      setChips(null);
      setProgressStep("Connecting...");
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 190000);

      try {
        const res = await fetch(`/api/cases/${caseId}/next-turn`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            caseId,
            user_message: directive,
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
          throw new Error(detail);
        }

        // Read NDJSON stream for real-time progress
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop()!; // Keep incomplete line in buffer

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line);
              if (event.type === "progress") {
                setProgressStep(event.message);
              } else if (event.type === "result") {
                const data: TurnResponse = event.data;
                setGameState(data.game_state);
                if (data.chips) setChips(data.chips);
                else if (data.game_state === "active") setChips(DEFAULT_CHIPS);
                else setChips(null);
                if (data.counter_offer_rm != null) setCounterOffer(data.counter_offer_rm);
                if (!data.auditor_passed && data.auditor_warning) {
                  setAuditorWarning(data.auditor_warning);
                }
                setCurrentRound(data.current_round);
                if (data.counter_offer_rm != null && caseData?.amount) {
                  const ratio = (data.counter_offer_rm / caseData.amount) * 100;
                  setSettlementValue(Math.min(100, Math.max(0, ratio)));
                }
              } else if (event.type === "error") {
                throw new Error(event.message);
              }
            } catch (parseErr: any) {
              if (parseErr.message && !parseErr.message.includes("JSON")) throw parseErr;
              console.warn("Skipping malformed NDJSON line");
            }
          }
        }
      } catch (error: any) {
        console.error("Turn error:", error);
        const message = error?.name === "AbortError"
          ? "Request timed out. Please retry."
          : (error.message || "Failed to process turn");
        setProgressStep(`\u274c ${message}`);
        // Keep the error visible for 4 seconds before clearing
        await new Promise((r) => setTimeout(r, 4000));
      } finally {
        clearTimeout(timeoutId);
        setSending(false);
        setProgressStep(null);
        setInput("");
      }
    },
    [caseId, evidenceUris, caseData, sending]
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

  const isActive = gameState === "active";
  const isSettled = gameState === "settled";
  const isDeadlock = gameState === "deadlock";
  const mediatorGatePassed = currentRound < 3 || mediatorShown;
  const commanderInputEnabled = isActive && mediatorGatePassed;

  useEffect(() => {
    if (!isActive || sending || showDecision || mediatorShown) return;
    if (currentRound !== 2 || mediatorAutoTriggered) return;

    setMediatorAutoTriggered(true);
    setSelectedChip(null);
    setChips(null);
    handleSend("");
  }, [
    isActive,
    sending,
    showDecision,
    mediatorShown,
    currentRound,
    mediatorAutoTriggered,
    handleSend,
  ]);

  useEffect(() => {
    if (mediatorShown) setMediatorAutoTriggered(true);
  }, [mediatorShown]);

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

  return (
    <div className="bg-off-white min-h-screen font-sans antialiased text-gray-900 flex justify-center">
      <div className="w-full max-w-md md:max-w-7xl md:grid md:grid-cols-[140px_1fr_140px] min-h-screen">
        {/* ── Defendant Avatar (desktop only, left side) ── */}
        <div className="hidden md:flex flex-col items-center justify-center gap-3 sticky top-0 h-screen">
          <div className="w-28 h-28 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center shadow-lg">
            <span className="material-icons text-5xl">person</span>
          </div>
          <span className="text-sm font-bold uppercase tracking-wider text-gray-500">Defendant</span>
        </div>

        {/* ── Chat Column ── */}
        <div className="bg-white min-h-screen shadow-2xl relative flex flex-col">
        {/* ── Sticky Header + Settlement Meter ── */}
        <div className="sticky top-0 z-20">
        <header className="px-5 py-4 border-b border-gray-100 flex items-center gap-3 bg-white">
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

        {/* ── Settlement Meter (sticky with header) ── */}
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
        </div>

        {/* ── Chat Messages ── */}
        <div ref={chatBoxRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-12">
              <span className="material-icons text-5xl text-gray-200 mb-3 block">smart_toy</span>
              <p className="text-sm text-gray-400">
                Choose a strategy below to start the AI negotiation
              </p>
              <p className="text-[10px] text-gray-300 mt-1">
                Your AI agent will argue on your behalf
              </p>
            </div>
          )}

          {messages.map((msg) => {
            // Directive messages are shown as small right-aligned bubbles (matching plaintiff side)
            if (msg.role === "directive") {
              return (
                <div key={msg.id} className="flex justify-end">
                  <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-1.5 max-w-[70%]">
                    <p className="text-[10px] text-indigo-400 font-medium italic text-right">
                      Strategy: {msg.content}
                    </p>
                  </div>
                </div>
              );
            }

            const isPlaintiff = msg.role === "plaintiff" || msg.role === "user";
            const isMediator = msg.role === "mediator";
            return (
              <div key={msg.id} className={`flex ${isMediator ? "justify-center" : isPlaintiff ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                    isPlaintiff
                      ? "bg-[#1a2a3a] text-white rounded-br-md"
                      : isMediator
                      ? "bg-amber-50 text-amber-900 border border-amber-200 rounded-bl-md"
                      : "bg-gray-100 text-gray-900 rounded-bl-md"
                  } ${isMediator ? "text-center" : ""}`}
                >
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1 opacity-60">
                    {isPlaintiff
                      ? "Your Agent"
                      : msg.role === "defendant"
                      ? "Opponent"
                      : msg.role === "mediator"
                      ? "Mediator"
                      : msg.role}
                  </p>
                  <p className={`text-sm leading-relaxed whitespace-pre-wrap ${isMediator ? "text-center" : ""}`}>{msg.content}</p>
                  {msg.round && (
                    <p className="text-[9px] mt-1.5 opacity-40">Round {msg.round}</p>
                  )}
                  {/* ── Per-message Auditor Status ── */}
                  {(msg.role === "defendant" || msg.role === "plaintiff") && msg.auditor_passed === true && (
                    <div className="flex items-center gap-1 mt-2">
                      <span className="material-icons text-green-500" style={{ fontSize: 14 }}>verified</span>
                      <span className="text-[10px] text-green-600 font-semibold">Audit Passed</span>
                    </div>
                  )}
                  {(msg.role === "defendant" || msg.role === "plaintiff") && msg.auditor_passed === false && (
                    <div className="mt-2 space-y-1.5">
                      <div className="flex items-center gap-1">
                        <span className="material-icons text-red-500" style={{ fontSize: 14 }}>error</span>
                        <span className="text-[10px] text-red-600 font-semibold">Audit Failed</span>
                      </div>
                      {msg.auditor_warning && (
                        <p className="text-[10px] text-red-500 leading-snug">{msg.auditor_warning}</p>
                      )}
                      <div className="flex gap-2 mt-1">
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            const btn = e.currentTarget;
                            btn.disabled = true;
                            btn.textContent = "Retrying...";
                            try {
                              const res = await fetch(
                                `/api/cases/${caseId}/messages/${msg.id}/audit-retry`,
                                { method: "POST" }
                              );
                              if (!res.ok) throw new Error("Retry failed");
                            } catch (err: any) {
                              alert(err.message || "Retry failed");
                            } finally {
                              btn.disabled = false;
                              btn.textContent = "Retry";
                            }
                          }}
                          className="text-[10px] font-semibold px-2.5 py-1 rounded-md bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
                        >
                          Retry
                        </button>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              const res = await fetch(
                                `/api/cases/${caseId}/messages/${msg.id}/audit-dismiss`,
                                { method: "PATCH" }
                              );
                              if (!res.ok) throw new Error("Dismiss failed");
                            } catch (err: any) {
                              alert(err.message || "Dismiss failed");
                            }
                          }}
                          className="text-[10px] font-semibold px-2.5 py-1 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                        >
                          Proceed Anyway
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Sending indicator with real-time progress */}
          {sending && (
            <div className="flex justify-center">
              <div className={`border rounded-2xl px-6 py-4 max-w-[80%] shadow-sm ${
                progressStep?.startsWith("\u274c") || progressStep?.startsWith("\u26a0")
                  ? "bg-gradient-to-r from-red-50 to-yellow-50 border-red-200"
                  : "bg-gradient-to-r from-gray-50 to-indigo-50 border-gray-200"
              }`}>
                <div className="flex items-center gap-3 mb-2">
                  {progressStep?.startsWith("\u274c") ? (
                    <span className="material-icons text-red-500" style={{ fontSize: 20 }}>error</span>
                  ) : progressStep?.startsWith("\u26a0") ? (
                    <span className="material-icons text-yellow-500" style={{ fontSize: 20 }}>warning</span>
                  ) : (
                    <div className="relative w-5 h-5">
                      <div className="absolute inset-0 border-2 border-indigo-200 rounded-full" />
                      <div className="absolute inset-0 border-2 border-indigo-500 rounded-full border-t-transparent animate-spin" />
                    </div>
                  )}
                  <p className={`text-xs font-bold uppercase tracking-wider ${
                    progressStep?.startsWith("\u274c") ? "text-red-600"
                    : progressStep?.startsWith("\u26a0") ? "text-yellow-600"
                    : "text-indigo-600"
                  }`}>
                    {progressStep?.startsWith("\u274c") ? "Error" : progressStep?.startsWith("\u26a0") ? "Warning" : "Agents Deliberating"}
                  </p>
                  <span className="text-[10px] text-gray-400 tabular-nums ml-auto">
                    {Math.floor(elapsedSecs / 60)}:{String(elapsedSecs % 60).padStart(2, "0")}
                  </span>
                </div>
                {progressStep && (
                  <p className={`text-sm font-medium pl-8 ${
                    progressStep?.startsWith("\u274c") ? "text-red-600"
                    : progressStep?.startsWith("\u26a0") ? "text-yellow-600"
                    : "text-gray-600 animate-pulse"
                  }`}>
                    {progressStep}
                  </p>
                )}
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

        {/* ── Strategy Chips (Commander's Console) ── */}
        {/* Gate: for round 3+, only show chips after mediator has appeared */}
        {chips && commanderInputEnabled && !sending && !selectedChip && (
          <div className="px-5 py-4 bg-gradient-to-r from-gray-50 to-indigo-50/30 border-t border-gray-100">
            <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider mb-0.5 text-center">
              Strategic Decision
            </p>
            <p className="text-xs text-gray-600 mb-3 text-center">
              {chips.question}
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {chips.options.map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => setSelectedChip(opt.label)}
                  className="bg-white border border-indigo-200 text-gray-800 text-xs font-semibold px-4 py-2.5 rounded-full hover:bg-[#1a2a3a] hover:text-white hover:border-[#1a2a3a] transition-all shadow-sm"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Selected Chip: Add optional text directive before sending ── */}
        {selectedChip && commanderInputEnabled && (
          <div className="px-5 py-4 bg-gradient-to-r from-indigo-50/40 to-gray-50 border-t border-indigo-100">
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-flex items-center gap-1.5 bg-[#1a2a3a] text-white text-xs font-semibold px-3 py-1.5 rounded-full">
                <span className="material-icons" style={{ fontSize: 14 }}>psychology</span>
                {selectedChip}
              </span>
              <button
                onClick={() => setSelectedChip(null)}
                disabled={sending}
                className="text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
                title="Change strategy"
              >
                <span className="material-icons" style={{ fontSize: 16 }}>close</span>
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowEvidence(true)}
                disabled={sending}
                className="w-11 h-11 rounded-full bg-gray-50 flex items-center justify-center hover:bg-gray-100 transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Upload Evidence"
              >
                <span className="material-icons text-lg text-gray-600">attach_file</span>
              </button>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    const directive = input.trim()
                      ? `${selectedChip} — ${input.trim()}`
                      : selectedChip;
                    setSelectedChip(null);
                    handleSend(directive);
                  }
                }}
                placeholder="Add details to your strategy (optional)..."
                disabled={sending}
                className="flex-1 bg-white border border-gray-200 rounded-full px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a2a3a]/20 focus:border-[#1a2a3a] placeholder:text-gray-400 disabled:opacity-50"
              />
              <button
                onClick={() => {
                  const directive = input.trim()
                    ? `${selectedChip} — ${input.trim()}`
                    : selectedChip;
                  setSelectedChip(null);
                  handleSend(directive);
                }}
                disabled={sending}
                className="w-11 h-11 bg-[#1a2a3a] text-white rounded-full flex items-center justify-center hover:bg-[#243447] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                <span className="material-icons text-lg">
                  {sending ? "hourglass_empty" : "send"}
                </span>
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-2 text-center">
              Press Enter or click the send button to proceed with this strategy
            </p>
          </div>
        )}

        {/* ── Input Bar (hidden when chip is selected — chip panel has its own input) ── */}
        {commanderInputEnabled && !selectedChip && (
          <div className="px-4 py-3 border-t border-gray-100 bg-white sticky bottom-0">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowEvidence(true)}
                disabled={sending}
                className="w-11 h-11 rounded-full bg-gray-50 flex items-center justify-center hover:bg-gray-100 transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Upload Evidence"
              >
                <span className="material-icons text-lg text-gray-600">attach_file</span>
              </button>
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
                placeholder="Guide your agent (optional)..."
                disabled={sending}
                className="flex-1 bg-gray-50 border border-gray-200 rounded-full px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a2a3a]/20 focus:border-[#1a2a3a] placeholder:text-gray-400 disabled:opacity-50"
              />
              <button
                onClick={() => handleSend(input)}
                disabled={sending}
                className="w-11 h-11 bg-[#1a2a3a] text-white rounded-full flex items-center justify-center hover:bg-[#243447] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                <span className="material-icons text-lg">
                  {sending ? "hourglass_empty" : "send"}
                </span>
              </button>
            </div>
          </div>
        )}

        {isActive && currentRound >= 3 && !mediatorShown && !sending && (
          <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 text-center">
            <p className="text-xs text-gray-500">
              Mediator intervention is being prepared. Controls will unlock after the mediator message.
            </p>
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

        {/* ── Plaintiff Avatar (desktop only, right side) ── */}
        <div className="hidden md:flex flex-col items-center justify-center gap-3 sticky top-0 h-screen">
          <div className="w-28 h-28 rounded-full bg-[#1a2a3a] text-white flex items-center justify-center shadow-lg">
            <span className="material-icons text-5xl">person</span>
          </div>
          <span className="text-sm font-bold uppercase tracking-wider text-gray-500">Plaintiff</span>
        </div>
      </div>
    </div>
  );
}
