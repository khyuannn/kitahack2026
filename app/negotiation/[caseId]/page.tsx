"use client";

import React, { useState, useEffect, useRef, useCallback, Suspense } from "react";
import ReactMarkdown from "react-markdown";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "@/firebase/config";
import { useCaseMessages } from "@/hooks/useCaseMessages";
import SettlementMeter from "@/app/components/settlementMeter";
import EvidenceModal from "@/app/components/EvidenceModal";
import { useAuth } from "@/hooks/useAuth";
import InviteModal from "@/app/components/inviteModal";
import EvidenceSidebar from "@/app/components/EvidenceSidebar";
import PdfPreviewModal from "@/app/components/PdfPreviewModal";

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
  current_turn?: string;
  pending_decision_role?: string | null;
}

interface AttachedEvidence {
  uri: string;
  name: string;
  type: string;
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

const DEFAULT_DEFENDANT_CHIPS: ChipOptions = {
  question: "How should your AI agent respond to the claim?",
  options: [
    { label: "Challenge Evidence", strategy_id: "challenge_evidence" },
    { label: "Propose Counter-Offer", strategy_id: "counter_offer" },
    { label: "Request More Details", strategy_id: "request_details" },
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
  mode?: "ai" | "pvp";
  plaintiffUserId?: string;
  defendantUserId?: string;
  currentTurn?: string;
  turnStatus?: string;
  pvpRound?: number;
  defendantDisplayName?: string;
  plaintiffDisplayName?: string;
  defendantIsAnonymous?: boolean;
  defendantResponded?: boolean;
  nextChips?: ChipOptions | null;
  defendantCeilingPrice?: number;
  pendingDecisionRole?: string | null;
}

export default function NegotiationPageWrapper() {
  return (
    <Suspense fallback={
      <div className="bg-off-white min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <span className="material-icons text-4xl text-gray-300 animate-pulse">balance</span>
          <p className="text-sm text-gray-400 font-medium">Loading...</p>
        </div>
      </div>
    }>
      <NegotiationPage />
    </Suspense>
  );
}

function NegotiationPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawCaseId = params.caseId;
  const caseId = (Array.isArray(rawCaseId) ? rawCaseId[0] : rawCaseId) || "";
  const roleParam = searchParams.get("role") as "plaintiff" | "defendant" | null;

  const {
    uid, isAnonymous,
    loading: authLoading,
    signInAnonymously: doAnonSignIn,
    upgradeAnonymousToGoogle,
  } = useAuth();

  /* ── State ── */
  const [caseData, setCaseData] = useState<CaseData | null>(null);
  const [caseLoading, setCaseLoading] = useState(true);
  const [caseRetryCount, setCaseRetryCount] = useState(0);
  const { messages, loading: messagesLoading } = useCaseMessages(caseId, !!uid);

  const [input, setInput] = useState("");
  const [currentRound, setCurrentRound] = useState(1);
  const [sending, setSending] = useState(false);
  const [progressStep, setProgressStep] = useState<string | null>(null);
  const [chips, setChips] = useState<ChipOptions | null>(DEFAULT_CHIPS);
  const [auditorWarning, setAuditorWarning] = useState<string | null>(null);
  const [gameState, setGameState] = useState("active");
  const [counterOffer, setCounterOffer] = useState<number | null>(null);
  const [plaintiffOffer, setPlaintiffOffer] = useState<number | null>(null);
  const [defendantOffer, setDefendantOffer] = useState<number | null>(null);
  const [defendantInitialOffer, setDefendantInitialOffer] = useState<number | null>(null);
  const [evidenceUris, setEvidenceUris] = useState<string[]>([]);
  const [attachedEvidence, setAttachedEvidence] = useState<AttachedEvidence[]>([]);

  // Two-step chip flow: user selects a chip, then optionally types extra context
  const [selectedChip, setSelectedChip] = useState<string | null>(null);
  // Track whether mediator has appeared (for gating round-3 chips)
  const [mediatorShown, setMediatorShown] = useState(false);
  const [mediatorAutoTriggered, setMediatorAutoTriggered] = useState(false);
  const [mediatorGenerating, setMediatorGenerating] = useState(false);
  const pendingRoundRef = useRef<number | null>(null);

  // Modals
  const [showEvidence, setShowEvidence] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [activeAudioMessageId, setActiveAudioMessageId] = useState<string | null>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeAudioIdRef = useRef<string | null>(null);

  // PvP state
  const [userRole, setUserRole] = useState<"plaintiff" | "defendant">(roleParam || "plaintiff");
  const [pvpJoining, setPvpJoining] = useState(false);
  const [pvpJoinError, setPvpJoinError] = useState<string | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showEvidenceDrawer, setShowEvidenceDrawer] = useState(false);
  const [pdfPreview, setPdfPreview] = useState<{ html: string; title: string; fileName: string } | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pendingOpeningMessage, setPendingOpeningMessage] = useState<{ content: string; offer?: number | null } | null>(null);
  const pvpJoinedRef = React.useRef(false);

  // Draggable mobile evidence drawer FAB
  const [folderFabPos, setFolderFabPos] = useState<{ x: number; y: number } | null>(null);
  const folderFabDragRef = useRef({ dx: 0, dy: 0, moved: false, active: false });

  useEffect(() => {
    if (authLoading || uid) return;
    doAnonSignIn().catch((error) => {
      console.error("Anonymous sign-in failed before case subscription:", error);
    });
  }, [authLoading, uid, doAnonSignIn]);

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
  const [pendingDecisionRole, setPendingDecisionRole] = useState<string | null>(null);

  const chatBoxRef = useRef<HTMLDivElement>(null);

  const stopCurrentAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    activeAudioIdRef.current = null;
    setActiveAudioMessageId(null);
    setIsAudioPlaying(false);
  }, []);

  const playWithSpeechSynthesis = useCallback(async (text: string, role: string): Promise<void> => {
    if (!window.speechSynthesis) {
      throw new Error("Speech synthesis not supported");
    }
    window.speechSynthesis.cancel();
    // Brief pause after cancel() to avoid Chrome/Edge race condition (onerror on immediate speak)
    await new Promise((r) => setTimeout(r, 50));
    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text.replace(/[*_#]/g, ""));
      utterance.rate = 0.95;
      utterance.pitch = 1.0;
      // Force English locale so the browser picks an English voice even without explicit selection
      utterance.lang = "en-US";

      const allVoices = window.speechSynthesis.getVoices();
      // Prefer English voices; fall back to all voices only if no English voices found
      const voices = allVoices.filter(v => v.lang?.startsWith("en-"));
      const voicePool = voices.length > 0 ? voices : allVoices;

      if (voicePool.length > 0) {
        if (role === "plaintiff") {
          utterance.voice =
            voicePool.find(v => v.name.includes("Guy") || v.name.includes("David") || v.name.includes("James") || v.name.includes("Male")) ||
            voicePool[0];
          utterance.pitch = 0.9;
        } else if (role === "defendant") {
          utterance.voice =
            voicePool.find(v => v.name.includes("Jenny") || v.name.includes("Zira") || v.name.includes("Sara") || v.name.includes("Female")) ||
            voicePool[Math.min(1, voicePool.length - 1)];
          utterance.pitch = 1.1;
        } else {
          utterance.voice =
            voicePool.find(v => v.name.includes("Aria") || v.name.includes("Daniel") || v.name.includes("Google")) ||
            voicePool[Math.min(2, voicePool.length - 1)];
          utterance.pitch = 1.0;
          utterance.rate = 0.9;
        }
      }
      utterance.onend = () => resolve();
      utterance.onerror = (e) => reject(e);
      window.speechSynthesis.speak(utterance);
    });
  }, []);

  const playMessageAudio = useCallback(async (message: { id: string; audio_url?: string | null; content?: string; role?: string }, autoplay = false) => {
    // If currently playing this message, toggle pause/stop
    if (activeAudioIdRef.current === message.id) {
      if (audioRef.current && !audioRef.current.paused) {
        stopCurrentAudio();
        return;
      }
      if (audioRef.current) {
        try {
          await audioRef.current.play();
          setIsAudioPlaying(true);
        } catch {
          if (!autoplay) alert("Unable to play audio right now.");
        }
        return;
      }
      // Speech synthesis is playing — stop it
      if (window.speechSynthesis?.speaking) {
        window.speechSynthesis.cancel();
        activeAudioIdRef.current = null;
        setActiveAudioMessageId(null);
        setIsAudioPlaying(false);
        return;
      }
    }

    stopCurrentAudio();
    window.speechSynthesis?.cancel();

    if (message.audio_url) {
      const player = new Audio(message.audio_url);
      audioRef.current = player;
      activeAudioIdRef.current = message.id;
      setActiveAudioMessageId(message.id);
      setIsAudioPlaying(false);

      player.onplay = () => {
        if (activeAudioIdRef.current === message.id) setIsAudioPlaying(true);
      };
      player.onpause = () => {
        if (activeAudioIdRef.current === message.id) setIsAudioPlaying(false);
      };
      player.onended = () => {
        if (activeAudioIdRef.current === message.id) {
          audioRef.current = null;
          activeAudioIdRef.current = null;
          setActiveAudioMessageId(null);
          setIsAudioPlaying(false);
        }
      };

      // Wait for the audio to be loadable before playing
      try {
        await new Promise<void>((resolve, reject) => {
          player.oncanplaythrough = () => resolve();
          player.onerror = (e) => {
            console.warn("Edge TTS audio load error:", e);
            reject(new Error("Audio failed to load"));
          };
          // Timeout: if audio doesn't load in 10s, fall back
          setTimeout(() => reject(new Error("Audio load timeout")), 10000);
          player.load();
        });
        await player.play();
        setIsAudioPlaying(true);
      } catch (loadErr) {
        // Edge TTS audio URL failed — clean up and fall back to speech synthesis
        console.warn("Edge TTS failed, falling back to Web Speech API:", loadErr);
        if (activeAudioIdRef.current === message.id) {
          audioRef.current = null;
        }
        if (message.content) {
          try {
            await playWithSpeechSynthesis(message.content, message.role || "plaintiff");
          } catch {
            if (!autoplay) console.warn("Both audio URL and speech synthesis failed");
          } finally {
            if (activeAudioIdRef.current === message.id) {
              activeAudioIdRef.current = null;
              setActiveAudioMessageId(null);
              setIsAudioPlaying(false);
            }
          }
          return;
        }
        if (!autoplay) alert("Autoplay was blocked. Press play again to start audio.");
        if (activeAudioIdRef.current === message.id) {
          audioRef.current = null;
          activeAudioIdRef.current = null;
          setActiveAudioMessageId(null);
          setIsAudioPlaying(false);
        }
      }
    } else if (message.content) {
      activeAudioIdRef.current = message.id;
      setActiveAudioMessageId(message.id);
      setIsAudioPlaying(true);
      try {
        await playWithSpeechSynthesis(message.content, message.role || "plaintiff");
      } catch {
        if (!autoplay) console.warn("Speech synthesis failed");
      } finally {
        if (activeAudioIdRef.current === message.id) {
          activeAudioIdRef.current = null;
          setActiveAudioMessageId(null);
          setIsAudioPlaying(false);
        }
      }
    }
  }, [stopCurrentAudio, playWithSpeechSynthesis]);

  /* ── Load case data (real-time) ── */
  useEffect(() => {
    if (!caseId || !uid) return;

    const unsub = onSnapshot(
      doc(db, "cases", caseId),
      (snap) => {
        if (snap.exists()) {
          setCaseData(snap.data() as CaseData);
        }
        setCaseLoading(false);
        if (caseRetryCount > 0) setCaseRetryCount(0);
      },
      (error) => {
        console.error("Failed to subscribe case document:", error);
        if (caseRetryCount < 3) {
          console.warn(`Retrying case document subscription (attempt ${caseRetryCount + 1}/3)...`);
          setTimeout(() => setCaseRetryCount((r) => r + 1), 2000 * (caseRetryCount + 1));
        } else {
          setCaseLoading(false);
        }
      }
    );

    return () => unsub();
  }, [caseId, uid, caseRetryCount]);

  /* ── Derive PvP mode ── */
  const isPvp = caseData?.mode === "pvp";
  const defendantJoined = !!caseData?.defendantUserId;
  const isMyTurn = isPvp
    ? caseData?.currentTurn === userRole && caseData?.turnStatus === "waiting"
    : true;

  /* ── Determine user role from UID vs case data ── */
  useEffect(() => {
    if (!caseData || !uid) return;
    if (caseData.plaintiffUserId === uid) setUserRole("plaintiff");
    else if (caseData.defendantUserId === uid) setUserRole("defendant");
    else if (roleParam) setUserRole(roleParam);
  }, [caseData, uid, roleParam]);

  /* ── PvP: Defendants must go through response page before joining ── */
  useEffect(() => {
    if (!isPvp || roleParam !== "defendant" || !caseId || !caseData) return;
    if (!uid) return;

    const joinedDefendantUid = caseData.defendantUserId;
    if (!joinedDefendantUid || joinedDefendantUid !== uid) {
      router.replace(`/case/${caseId}/respond`);
    }
  }, [isPvp, roleParam, caseId, caseData, uid, router]);

  /* ── PvP: Set default chips when it becomes user's turn ── */
  useEffect(() => {
    if (!isPvp || !isMyTurn || sending || !defendantJoined) return;
    const generated = caseData?.nextChips;
    if (generated?.question && Array.isArray(generated.options) && generated.options.length > 0) {
      setChips(generated);
    } else {
      const defaults = userRole === "defendant" ? DEFAULT_DEFENDANT_CHIPS : DEFAULT_CHIPS;
      setChips(defaults);
    }
    setSelectedChip(null);
  }, [isPvp, isMyTurn, userRole, sending, defendantJoined, caseData?.nextChips]);

  /* ── PvP: Defensively clear chips when defendant hasn't joined ── */
  useEffect(() => {
    if (isPvp && !defendantJoined) {
      setChips(null);
      setSelectedChip(null);
    }
  }, [isPvp, defendantJoined]);

  /* ── PvP: Auto-open invite modal when defendant hasn't joined ── */
  useEffect(() => {
    if (isPvp && userRole === "plaintiff" && !defendantJoined && caseData && !caseLoading) {
      setShowInviteModal(true);
    }
  }, [isPvp, userRole, defendantJoined, caseData, caseLoading]);

  /* ── PvP: Auto-close invite modal after defendant joins (2s delay) ── */
  useEffect(() => {
    if (isPvp && defendantJoined && showInviteModal) {
      const timer = setTimeout(() => setShowInviteModal(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [isPvp, defendantJoined, showInviteModal]);

  /* ── Round is now derived from backend response, not messages ── */

  /* ── Sync state from case document (important for PvP cross-client updates) ── */
  useEffect(() => {
    if (!caseData) return;

    if (typeof caseData.pvpRound === "number") {
      setCurrentRound(caseData.pvpRound);
    }

    const stateFromCase =
      caseData.game_state ||
      (caseData.status === "done"
        ? "settled"
        : caseData.status === "deadlock"
        ? "deadlock"
        : caseData.status === "pending_decision"
        ? "pending_decision"
        : null);

    if (stateFromCase) {
      setGameState(stateFromCase);
    }

    if (caseData.pendingDecisionRole) setPendingDecisionRole(caseData.pendingDecisionRole);
    else setPendingDecisionRole(null);
  }, [caseData]);

  /* ── Parse offers from message history ── */
  useEffect(() => {
    if (!messages.length) return;
    for (const msg of messages) {
      if (msg.counter_offer_rm != null) {
        if (msg.role === "plaintiff") setPlaintiffOffer(msg.counter_offer_rm);
        else if (msg.role === "defendant") {
          setDefendantOffer(msg.counter_offer_rm);
          // Capture defendant's very first offer as scale left anchor
          if (msg.round === 0 || msg.round === 1) {
            setDefendantInitialOffer((prev) => prev ?? msg.counter_offer_rm);
          }
        }
      }
    }
  }, [messages]);

  useEffect(() => {
    if (!caseId || roleParam !== "defendant" || typeof window === "undefined") return;
    const key = `pendingDefendantOpening:${caseId}`;
    const raw = sessionStorage.getItem(key);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { content?: string; offer?: number | null };
      if (parsed.content && parsed.content.trim()) {
        setPendingOpeningMessage({
          content: parsed.content.trim(),
          offer: parsed.offer ?? null,
        });
      }
    } catch {
    }
  }, [caseId, roleParam]);

  useEffect(() => {
    if (!pendingOpeningMessage || !caseId || typeof window === "undefined") return;
    const hasRealOpening = messages.some(
      (m) => m.role === "defendant" && m.content?.trim() === pendingOpeningMessage.content
    );
    if (hasRealOpening) {
      setPendingOpeningMessage(null);
      sessionStorage.removeItem(`pendingDefendantOpening:${caseId}`);
    }
  }, [messages, pendingOpeningMessage, caseId]);

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
    if (gameState === "pending_accept") {
      setShowDecision(pendingDecisionRole === userRole);
      return;
    }
    if (gameState === "pending_decision") {
      setShowDecision(!isPvp || userRole === "plaintiff");
      return;
    }
    setShowDecision(false);
  }, [gameState, isPvp, userRole, pendingDecisionRole]);

  /* ── Track mediator appearance for chip gating ── */
  useEffect(() => {
    if (messages.some((m) => m.role === "mediator")) {
      setMediatorShown(true);
      setMediatorGenerating(false);
    }
  }, [messages]);

  useEffect(() => {
    return () => {
      stopCurrentAudio();
    };
  }, [stopCurrentAudio]);

  // Init folder FAB to bottom-right corner (matches original fixed position)
  useEffect(() => {
    if (typeof window !== "undefined" && folderFabPos === null) {
      setFolderFabPos({ x: window.innerWidth - 40, y: window.innerHeight - 104 });
    }
  }, []);

  /* ── Send directive (calls /api/cases/{caseId}/next-turn or pvp-turn with streaming) ── */
  const handleSend = useCallback(
    async (message: string) => {
      if (sending) return;
      const directive = message?.trim() || "";
      setSending(true);
      setAuditorWarning(null);
      setChips(null);
      setProgressStep("Connecting...");
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 270000);

      try {
        const backendBaseUrl =
          process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "") ||
          (typeof window !== "undefined" && window.location.hostname === "localhost"
            ? "http://127.0.0.1:8005"
            : "");

        const endpoint = backendBaseUrl
          ? (isPvp
              ? `${backendBaseUrl}/api/cases/${caseId}/pvp-turn`
              : `${backendBaseUrl}/api/cases/${caseId}/next-turn`)
          : (isPvp
              ? `/api/cases/${caseId}/pvp-turn`
              : `/api/cases/${caseId}/next-turn`);

        const bodyPayload = isPvp
          ? {
              caseId,
              user_message: directive,
              user_role: userRole,
              userId: uid || "",
              evidence_uris: evidenceUris,
              floor_price: caseData?.floorPrice ?? null,
            }
          : {
              caseId,
              user_message: directive,
              evidence_uris: evidenceUris,
              floor_price: caseData?.floorPrice ?? null,
            };

        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify(bodyPayload),
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
              if (event.type === "progress" && event.step !== "heartbeat") {
                setProgressStep(event.message);
              } else if (event.type === "result") {
                const data: TurnResponse = event.data;
                setGameState(data.game_state);
                if (data.pending_decision_role != null) setPendingDecisionRole(data.pending_decision_role);
                else setPendingDecisionRole(null);
                // In PvP, chips for the next player come via Firestore/effect — skip here
                if (!isPvp) {
                  if (data.chips?.question && data.chips?.options?.length > 0) {
                    setChips(data.chips);
                  } else if (data.game_state === "active") {
                    setChips(userRole === "defendant" ? DEFAULT_DEFENDANT_CHIPS : DEFAULT_CHIPS);
                  } else {
                    setChips(null);
                  }
                } else {
                  setChips(null); // Clear chips; they'll reload via the turn-change effect
                }
                if (data.counter_offer_rm != null) {
                  setCounterOffer(data.counter_offer_rm);
                  // Track per-role offers
                  if (isPvp) {
                    // In PvP, the response is for the user's role
                    if (userRole === "plaintiff") setPlaintiffOffer(data.counter_offer_rm);
                    else setDefendantOffer(data.counter_offer_rm);
                  } else {
                    // In AI mode, agent_message is defendant, plaintiff_message is plaintiff
                    setDefendantOffer(data.counter_offer_rm);
                  }
                }
                // Track plaintiff offer from AI mode plaintiff_message
                if (!isPvp && data.plaintiff_message) {
                  // The plaintiff offer comes through the full result
                  // We already set defendantOffer above; plaintiffOffer is tracked from messages
                }
                if (!data.auditor_passed && data.auditor_warning) {
                  setAuditorWarning(data.auditor_warning);
                }
                pendingRoundRef.current = data.current_round;
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
        if (pendingRoundRef.current !== null) {
          setCurrentRound(pendingRoundRef.current);
          pendingRoundRef.current = null;
        }
        setSending(false);
        setProgressStep(null);
        setInput("");
        setEvidenceUris([]);
        setAttachedEvidence([]);
      }
    },
    [caseId, evidenceUris, caseData, sending, isPvp, userRole, uid]
  );

  /* ── Accept / Reject offer ── */
  const handleAcceptOffer = async () => {
    setDecidingAccept(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/accept-offer`, {
        method: "POST",
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Accept failed (${res.status})`);
      }
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
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Reject failed (${res.status})`);
      }
      setGameState("deadlock");
      setShowDecision(false);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setDecidingReject(false);
    }
  };

  const handleContinueNegotiation = async () => {
    setDecidingReject(true);
    try {
      await fetch(`/api/cases/${caseId}/continue-negotiation`, { method: "POST" });
      setGameState("active");
      setPendingDecisionRole(null);
      setShowDecision(false);
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
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Export failed (${res.status})`);
      }
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
  const handleEvidenceValidated = (fileUri: string, fileName: string, fileType: string, evidenceId?: string) => {
    setEvidenceUris((prev) => {
      if (prev.includes(fileUri)) return prev;
      return [...prev, fileUri];
    });
    setAttachedEvidence((prev) => {
      if (prev.some((item) => item.uri === fileUri)) return prev;
      return [...prev, { uri: fileUri, name: fileName, type: fileType }];
    });
    // Directly overwrite uploadedBy in Firestore using the Firebase client SDK —
    // this bypasses any proxy issues with multipart form data stripping the field.
    if (evidenceId && caseId) {
      const evidenceRef = doc(db, "cases", caseId, "evidence", evidenceId);
      updateDoc(evidenceRef, { uploadedBy: userRole }).catch((e) =>
        console.warn("[Evidence] Failed to set uploadedBy:", e)
      );
    }
  };

  const removeAttachedEvidence = (uri: string) => {
    setEvidenceUris((prev) => prev.filter((item) => item !== uri));
    setAttachedEvidence((prev) => prev.filter((item) => item.uri !== uri));
  };

  const onFolderFabPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    folderFabDragRef.current = {
      dx: e.clientX - (folderFabPos?.x ?? 0),
      dy: e.clientY - (folderFabPos?.y ?? 0),
      moved: false,
      active: true,
    };
  };

  const onFolderFabPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!folderFabDragRef.current.active || !folderFabPos) return;
    const nx = e.clientX - folderFabDragRef.current.dx;
    const ny = e.clientY - folderFabDragRef.current.dy;
    if (Math.abs(nx - folderFabPos.x) > 5 || Math.abs(ny - folderFabPos.y) > 5)
      folderFabDragRef.current.moved = true;
    setFolderFabPos({
      x: Math.max(28, Math.min(window.innerWidth - 28, nx)),
      y: Math.max(28, Math.min(window.innerHeight - 28, ny)),
    });
  };

  const onFolderFabPointerUp = () => {
    const moved = folderFabDragRef.current.moved;
    folderFabDragRef.current.active = false;
    folderFabDragRef.current.moved = false;
    if (!moved) setShowEvidenceDrawer(true);
  };

  /* ── Invite link ── */
  const handleCopyInvite = async () => {
    const link = `${window.location.origin}/case/${caseId}/respond`;
    await navigator.clipboard.writeText(link);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  };

  const isActive = gameState === "active";
  const isSettled = gameState === "settled";
  const isDeadlock = gameState === "deadlock";
  const mediatorGatePassed = currentRound < 3 || mediatorShown;
  const commanderInputEnabled = isActive && mediatorGatePassed && (!isPvp || (isMyTurn && defendantJoined));
  const currentRoundDisplay = isPvp ? (caseData?.pvpRound ?? currentRound) : currentRound;

  /* ── Mediator auto-trigger (AI mode only) ── */
  useEffect(() => {
    if (isPvp) return; // Mediator injection handled server-side in PvP
    if (!isActive || sending || showDecision || mediatorShown) return;
    if (currentRound !== 2 || mediatorAutoTriggered) return;

    setMediatorAutoTriggered(true);
    setMediatorGenerating(true);
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

  /* ── PvP: Defendant joining screen ── */
  if (isPvp && roleParam === "defendant" && pvpJoining) {
    return (
      <div className="bg-off-white min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="relative w-10 h-10 mx-auto">
            <div className="absolute inset-0 border-2 border-indigo-200 rounded-full" />
            <div className="absolute inset-0 border-2 border-indigo-500 rounded-full border-t-transparent animate-spin" />
          </div>
          <p className="text-sm text-gray-500 font-medium">Joining negotiation...</p>
        </div>
      </div>
    );
  }

  /* ── PvP: Join error screen ── */
  if (isPvp && pvpJoinError) {
    return (
      <div className="bg-off-white min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3 max-w-sm px-4">
          <span className="material-icons text-4xl text-red-400">error</span>
          <p className="text-sm text-red-600 font-medium">{pvpJoinError}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 bg-[#1a2a3a] text-white px-4 py-2 rounded-lg text-sm hover:bg-[#243447]"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  /* ── PvP: Plaintiff waiting for defendant — FULL BLOCKING SCREEN ── */
  if (isPvp && userRole === "plaintiff" && !defendantJoined) {
    return (
      <div className="bg-off-white min-h-screen font-sans antialiased text-gray-900 flex justify-center">
        <div className="w-full max-w-md md:max-w-2xl bg-white min-h-screen shadow-2xl relative flex flex-col">
          {/* Header */}
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
                PvP Mode &middot; Waiting for Opponent
              </p>
            </div>
          </header>

          {/* Waiting content */}
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
            <div className="text-center space-y-6 max-w-sm">
              <div className="relative w-20 h-20 mx-auto">
                <div className="absolute inset-0 border-4 border-gray-100 rounded-full" />
                <div className="absolute inset-0 border-4 border-indigo-500 rounded-full border-t-transparent animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="material-icons text-3xl text-gray-300">group_add</span>
                </div>
              </div>

              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">Waiting for Opponent</h2>
                <p className="text-sm text-gray-500 leading-relaxed">
                  Share the invite link below to get the other party to join this negotiation.
                </p>
              </div>

              {/* Inline invite link box */}
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 text-left">
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Invite Link
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-2.5 overflow-hidden">
                    <p className="text-xs text-gray-600 truncate font-mono">
                      {typeof window !== "undefined"
                        ? `${window.location.origin}/case/${caseId}/respond`
                        : ""}
                    </p>
                  </div>
                  <button
                    onClick={handleCopyInvite}
                    className={`shrink-0 px-4 py-2.5 rounded-lg text-xs font-bold transition-all ${
                      inviteCopied
                        ? "bg-green-500 text-white"
                        : "bg-[#1a2a3a] text-white hover:bg-[#243447]"
                    }`}
                  >
                    {inviteCopied ? "Copied!" : "Copy Link"}
                  </button>
                </div>
              </div>

              {/* Open full invite modal */}
              <button
                onClick={() => setShowInviteModal(true)}
                className="text-sm font-semibold text-indigo-600 hover:text-indigo-800 transition-colors underline underline-offset-2"
              >
                View full invite details
              </button>

              {/* How PvP works */}
              <div className="border-t border-gray-100 pt-5">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">
                  How it works
                </p>
                <div className="space-y-2 text-left">
                  <div className="flex items-start gap-2.5">
                    <div className="w-5 h-5 bg-indigo-100 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[10px] font-bold text-indigo-600">1</span>
                    </div>
                    <p className="text-xs text-gray-500">Copy and send the invite link to the other party</p>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <div className="w-5 h-5 bg-indigo-100 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[10px] font-bold text-indigo-600">2</span>
                    </div>
                    <p className="text-xs text-gray-500">They join anonymously — no sign-in required</p>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <div className="w-5 h-5 bg-indigo-100 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[10px] font-bold text-indigo-600">3</span>
                    </div>
                    <p className="text-xs text-gray-500">Negotiation begins — both sides get an AI legal copilot</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Invite Modal (also available via "View full invite details") */}
          <InviteModal
            isOpen={showInviteModal}
            onClose={() => setShowInviteModal(false)}
            caseId={caseId}
            defendantJoined={defendantJoined}
            defendantDisplayName={caseData?.defendantDisplayName}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-off-white min-h-screen font-sans antialiased text-gray-900 flex justify-center">
      <div className="w-full max-w-md md:max-w-7xl md:grid md:grid-cols-[200px_1fr_200px] min-h-screen">
        {/* ── Opponent Avatar + Evidence (desktop only, left side) ── */}
        <div className="hidden md:flex flex-col items-center gap-3 sticky top-0 h-screen pt-8 px-2">
          <div className="w-24 h-24 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center shadow-lg shrink-0">
            <span className="material-icons text-4xl">person</span>
          </div>
          <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
            {userRole === "plaintiff" ? "Defendant" : "Plaintiff"}
          </span>
          <div className="w-full mt-2">
            <EvidenceSidebar
              caseId={caseId}
              side={userRole === "plaintiff" ? "defendant" : "plaintiff"}
            />
          </div>
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
            <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">
              <span className="text-sm text-gray-700">
                {mediatorGenerating
                  ? "Mediator Intervention"
                  : `Round ${currentRoundDisplay}`}
              </span>{" "}
              &middot; {" "}
              {isSettled ? "Settled" : isDeadlock ? "Deadlock" : isPvp ? `${userRole === "plaintiff" ? "Plaintiff" : "Defendant"}` : "Active"}
              {isPvp && isActive && (
                <span className={isMyTurn ? "text-green-600" : "text-amber-500"}>
                  {" "}&middot; {isMyTurn ? "Your Turn" : "Opponent's Turn"}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {/* Anonymous user sign-in upgrade */}
            {isAnonymous && (
              <button
                onClick={upgradeAnonymousToGoogle}
                className="h-9 px-3 rounded-lg bg-blue-50 text-blue-600 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 hover:bg-blue-100 transition-colors"
                title="Sign in with Google"
              >
                <span className="material-icons" style={{ fontSize: 16 }}>login</span>
                Sign in
              </button>
            )}
            {/* Share / Invite button */}
            <button
              onClick={isPvp ? () => setShowInviteModal(true) : handleCopyInvite}
              className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center hover:bg-gray-100 transition-colors"
              title={isPvp ? "Invite opponent" : "Copy invite link"}
            >
              <span className="material-icons text-lg text-gray-600">
                {inviteCopied ? "check" : isPvp ? "person_add" : "share"}
              </span>
            </button>
          </div>
        </header>

        <div className="px-5 pt-3 pb-4 bg-white border-b border-gray-100">
          <div
            className="mx-auto w-full max-w-[280px] rounded-2xl px-4 py-2.5 text-center"
            style={{
              background:
                "linear-gradient(to bottom, #1e3a5f, #1a2a3a) padding-box, " +
                "linear-gradient(135deg, #c8a840 0%, #e8c860 25%, #f5df90 50%, #e8c860 75%, #c8a840 100%) border-box",
              border: "6px solid transparent",
              boxShadow:
                "0 2px 14px rgba(200,180,104,0.28), 0 0 28px rgba(255,253,232,0.09)",
            }}
          >
            <p
              className="text-[10px] font-bold uppercase tracking-[0.18em]"
              style={{ color: "#d4bf7a" }}
            >
              Current Round
            </p>
            <p
              className="text-xl font-extrabold leading-tight mt-0.5"
              style={{
                color: "#dcc078",
                textShadow: "0 0 10px rgba(200,170,60,0.45), 0 1px 2px rgba(0,0,0,0.4)",
              }}
            >
              {mediatorGenerating
                ? "Mediator Intervention"
                : `Round ${currentRoundDisplay}`}
            </p>
          </div>
        </div>

        {/* ── Settlement Meter (sticky with header) ── */}
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
          <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 shadow-sm">
          <div className="grid grid-cols-3 items-center mb-1.5">
            <div className="flex justify-start">
              {defendantOffer != null && (
                <span className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-100 rounded-full px-2 py-0.5">
                  Defendant: RM {defendantOffer.toLocaleString()}
                </span>
              )}
            </div>
            <div className="flex justify-center">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                Settlement Progress
              </span>
            </div>
            <div className="flex justify-end">
              {plaintiffOffer != null && (
                <span className="text-[10px] font-bold text-fuchsia-700 bg-fuchsia-50 border border-fuchsia-100 rounded-full px-2 py-0.5">
                  Plaintiff: RM {plaintiffOffer.toLocaleString()}
                </span>
              )}
            </div>
          </div>
          <SettlementMeter
            claimAmount={caseData?.amount || 0}
            minAmount={defendantInitialOffer}
            plaintiffOffer={plaintiffOffer}
            defendantOffer={defendantOffer}
          />
          {/* Private price anchor — visible only to self, hidden from opponent */}
          <div className="flex justify-between mt-1">
            {userRole === "defendant" && caseData?.defendantCeilingPrice != null && caseData.defendantCeilingPrice > 0 ? (
              <span className="text-[9px] text-blue-400 font-semibold flex items-center gap-0.5">
                <span className="material-icons" style={{ fontSize: 9 }}>lock</span>
                Your ceiling: RM {caseData.defendantCeilingPrice.toLocaleString()}
              </span>
            ) : <span />}
            {userRole === "plaintiff" && caseData?.floorPrice != null && caseData.floorPrice > 0 ? (
              <span className="text-[9px] text-fuchsia-400 font-semibold flex items-center gap-0.5">
                Your floor: RM {caseData.floorPrice.toLocaleString()}
                <span className="material-icons" style={{ fontSize: 9 }}>lock</span>
              </span>
            ) : <span />}
          </div>
          </div>
        </div>
        </div>

        {/* ── Chat Messages ── */}
        <div ref={chatBoxRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* PvP: Waiting for opponent to join */}
          {isPvp && userRole === "plaintiff" && !defendantJoined && (
            <div className="text-center py-12">
              <span className="material-icons text-5xl text-gray-200 mb-3 block">group_add</span>
              <p className="text-sm text-gray-500 font-medium">
                Waiting for opponent to join...
              </p>
              <p className="text-[10px] text-gray-300 mt-1 mb-4">
                Share the invite link to get started
              </p>
              <button
                onClick={() => setShowInviteModal(true)}
                className="bg-[#1a2a3a] text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#243447] transition-colors"
              >
                <span className="material-icons align-middle mr-1.5" style={{ fontSize: 16 }}>person_add</span>
                Invite Opponent
              </button>
            </div>
          )}

          {messages.length === 0 && (!isPvp || defendantJoined) && (
            <div className="text-center py-12">
              <span className="material-icons text-5xl text-gray-200 mb-3 block">smart_toy</span>
              <p className="text-sm text-gray-400">
                {isPvp
                  ? `Choose a strategy below to start — you are the ${userRole}`
                  : "Choose a strategy below to start the AI negotiation"}
              </p>
              <p className="text-[10px] text-gray-300 mt-1">
                Your AI agent will argue on your behalf
              </p>
            </div>
          )}

          {pendingOpeningMessage && roleParam === "defendant" && (
            <div className="flex justify-center">
              <div className="max-w-[85%] rounded-2xl px-4 py-3 bg-green-50 text-green-900 border border-green-200">
                <div className="flex items-center gap-1.5 mb-2 pb-2 border-b border-green-200">
                  <span className="material-icons text-green-500" style={{ fontSize: 15 }}>person_add</span>
                  <p className="text-[10px] font-bold text-green-700 uppercase tracking-wider">
                    Defendant has joined the negotiation
                  </p>
                </div>
                <p className="text-[10px] font-bold text-green-600 uppercase tracking-wider mb-1">
                  Defendant Opening Argument
                </p>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{pendingOpeningMessage.content}</p>
                {pendingOpeningMessage.offer != null && (
                  <p className="text-[10px] mt-2 text-green-700 font-semibold">
                    Opening offer: RM {pendingOpeningMessage.offer.toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          )}

          {messages.map((msg) => {
            // Hide system messages
            if (msg.role === "system") return null;

            // Special render: round-0 defendant opening — combined joining + argument bubble (PvP only)
            if (isPvp && msg.role === "defendant" && msg.round === 0) {
              return (
                <div key={msg.id} className="flex justify-center">
                  <div className="max-w-[85%] rounded-2xl px-4 py-3 bg-green-50 text-green-900 border border-green-200">
                    <div className="flex items-center gap-1.5 mb-2 pb-2 border-b border-green-200">
                      <span className="material-icons text-green-500" style={{ fontSize: 15 }}>person_add</span>
                      <p className="text-[10px] font-bold text-green-700 uppercase tracking-wider">
                        Defendant has joined the negotiation
                      </p>
                    </div>
                    <p className="text-[10px] font-bold text-green-600 uppercase tracking-wider mb-1">
                      Defendant Opening Argument
                    </p>
                    <div className="text-sm leading-relaxed prose prose-sm max-w-none [&>p]:my-1">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                    {msg.counter_offer_rm != null && (
                      <p className="text-[10px] mt-2 text-green-700 font-semibold">
                        Opening offer: RM {msg.counter_offer_rm.toLocaleString()}
                      </p>
                    )}
                    <button
                      onClick={() => void playMessageAudio({ id: msg.id, audio_url: msg.audio_url, content: msg.content, role: msg.role })}
                      className={`mt-2 inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full transition-colors ${
                        activeAudioMessageId === msg.id && isAudioPlaying
                          ? "bg-red-100 text-red-700"
                          : "bg-green-100 text-green-700 hover:bg-green-200"
                      }`}
                    >
                      <span className="material-icons" style={{ fontSize: 13 }}>
                        {activeAudioMessageId === msg.id && isAudioPlaying ? "stop" : "play_arrow"}
                      </span>
                      {activeAudioMessageId === msg.id && isAudioPlaying ? "Stop audio" : "Play audio"}
                    </button>
                  </div>
                </div>
              );
            }

            // Directive messages are shown as small right-aligned bubbles (matching plaintiff side)
            if (msg.role === "directive") {
              const roleMatch = msg.content?.match(/^\[(PLAINTIFF|DEFENDANT)\]\s*/i);
              const directiveRole = roleMatch?.[1]?.toLowerCase() as "plaintiff" | "defendant" | undefined;
              const directiveText = roleMatch ? msg.content.replace(roleMatch[0], "") : msg.content;
              const isMyDirective = isPvp ? directiveRole === userRole : true;

              if (!isMyDirective) {
                return null;
              }

              const questionMatch = directiveText.match(/\[Q\]\s*([\s\S]*?)\s*\[CHIP\]/i);
              const chipMatch = directiveText.match(/\[CHIP\]\s*([\s\S]*?)\s*\[TEXT\]/i);
              const textMatch = directiveText.match(/\[TEXT\]\s*([\s\S]*)$/i);
              const parsedQuestion = questionMatch?.[1]?.trim();
              const parsedChip = chipMatch?.[1]?.trim();
              const parsedText = textMatch?.[1]?.trim();

              return (
                <div key={msg.id} className="flex justify-end">
                  <div className="rounded-xl px-3 py-2 max-w-[85%] bg-indigo-50 border border-indigo-100">
                    <p className="text-[10px] text-indigo-500 font-semibold uppercase tracking-wider text-left mb-1">
                      Your Strategy
                    </p>
                    {parsedQuestion || parsedChip || parsedText ? (
                      <div className="space-y-1 text-left">
                        {parsedQuestion && (
                          <p className="text-[10px] text-indigo-500">
                            <span className="font-semibold">Question:</span> {parsedQuestion}
                          </p>
                        )}
                        {parsedChip && (
                          <p className="text-[10px] text-indigo-600 font-semibold">
                            <span className="font-semibold">Chip:</span> {parsedChip}
                          </p>
                        )}
                        {parsedText && parsedText !== "-" && (
                          <p className="text-[10px] text-indigo-500">
                            <span className="font-semibold">Your text:</span> {parsedText}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-[10px] text-indigo-500 font-medium italic text-left">
                        {directiveText}
                      </p>
                    )}
                  </div>
                </div>
              );
            }

            // In PvP, mirror messages based on role; in AI, plaintiff always right
            const isMyMessage = isPvp
              ? msg.role === userRole
              : (msg.role === "plaintiff" || msg.role === "user");
            const isMediator = msg.role === "mediator";
            return (
              <div key={msg.id} className={`flex ${isMediator ? "justify-center" : isMyMessage ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                    isMyMessage
                      ? "bg-[#1a2a3a] text-white rounded-br-md"
                      : isMediator
                      ? "bg-amber-50 text-amber-900 border border-amber-200 rounded-bl-md"
                      : "bg-gray-100 text-gray-900 rounded-bl-md"
                  }`}
                >
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1 opacity-60">
                    {isMyMessage
                      ? "Your Agent"
                      : (msg.role === "defendant" || msg.role === "plaintiff")
                      ? "Opponent"
                      : msg.role === "mediator"
                      ? "Mediator"
                      : msg.role}
                  </p>
                  <div className="text-sm leading-relaxed prose prose-sm max-w-none [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                  {(msg.role === "plaintiff" || msg.role === "defendant" || msg.role === "mediator") && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void playMessageAudio({ id: msg.id, audio_url: msg.audio_url, content: msg.content, role: msg.role });
                      }}
                      className={`mt-2 inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full transition-colors ${
                        activeAudioMessageId === msg.id && isAudioPlaying
                          ? "bg-red-100 text-red-700"
                          : "bg-black/10 text-current hover:bg-black/15"
                      }`}
                    >
                      <span className="material-icons" style={{ fontSize: 13 }}>
                        {activeAudioMessageId === msg.id && isAudioPlaying ? "stop" : "play_arrow"}
                      </span>
                      {activeAudioMessageId === msg.id && isAudioPlaying
                        ? "Stop audio"
                        : activeAudioMessageId === msg.id
                        ? "Play again"
                        : "Play audio"}
                    </button>
                  )}
                  {!!msg.round && (
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

        {/* ── Pending Decision (Accept/Reject or Accept/Continue) ── */}
        {showDecision && (
          <div className="px-5 py-4 bg-blue-50 border-t border-blue-200">
            <p className="text-xs font-bold text-blue-900 mb-1">
              {gameState === "pending_accept" ? "Offer Within Your Range" : "Final Offer on the Table"}
            </p>
            {gameState === "pending_accept" && (
              <p className="text-sm text-blue-800 mb-2">
                {pendingDecisionRole === "plaintiff"
                  ? `The opponent's offer of RM ${(counterOffer ?? 0).toLocaleString()} meets or exceeds your floor price. Do you accept?`
                  : `The opponent's offer of RM ${(counterOffer ?? 0).toLocaleString()} is within your maximum amount. Do you accept?`}
              </p>
            )}
            {counterOffer != null && gameState !== "pending_accept" && (
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
                {decidingAccept ? "Accepting..." : "Accept"}
              </button>
              <button
                onClick={gameState === "pending_accept" ? handleContinueNegotiation : handleRejectOffer}
                disabled={decidingReject}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50"
              >
                {decidingReject
                  ? "..."
                  : gameState === "pending_accept"
                  ? "Continue Negotiation"
                  : "Reject & Go to Court"}
              </button>
            </div>
          </div>
        )}

        {/* ── Settled Banner ── */}
        {isSettled && (
          <div className="px-5 py-4 bg-green-50 border-t border-green-200 text-center">
            <span className="material-icons text-green-600 text-2xl mb-1">handshake</span>
            <p className="text-sm font-bold text-green-800">Settlement Reached</p>
            <p className="text-xs text-green-600 mt-1 mb-3">
              Both parties have agreed to a resolution.
            </p>
            <button
              onClick={async () => {
                setPdfLoading(true);
                try {
                  const res = await fetch(`/api/cases/${caseId}/generate-settlement-pdf`, { method: "POST" });
                  if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.detail || "Failed to generate document");
                  }
                  const data = await res.json();
                  setPdfPreview({
                    html: data.html,
                    title: "Settlement Agreement",
                    fileName: `settlement-${caseId}`,
                  });
                } catch (err: any) {
                  alert(err.message || "Failed to generate settlement agreement");
                } finally {
                  setPdfLoading(false);
                }
              }}
              disabled={pdfLoading}
              className="bg-[#1a2a3a] text-white font-semibold py-2.5 px-6 rounded-lg text-sm hover:bg-[#243447] transition-colors disabled:opacity-50"
            >
              {pdfLoading ? "Generating..." : "Generate Settlement Agreement"}
            </button>
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
              onClick={async () => {
                setPdfLoading(true);
                try {
                  const res = await fetch(`/api/cases/${caseId}/generate-deadlock-pdf`, { method: "POST" });
                  if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.detail || "Failed to generate document");
                  }
                  const data = await res.json();
                  setPdfPreview({
                    html: data.html,
                    title: "Court Filing (Form 206)",
                    fileName: `court-filing-${caseId}`,
                  });
                } catch (err: any) {
                  alert(err.message || "Failed to generate court filing");
                } finally {
                  setPdfLoading(false);
                }
              }}
              disabled={pdfLoading}
              className="bg-[#1a2a3a] text-white font-semibold py-2.5 px-6 rounded-lg text-sm hover:bg-[#243447] transition-colors disabled:opacity-50"
            >
              {pdfLoading ? "Generating..." : "Export Court Filing (Form 206)"}
            </button>
          </div>
        )}

        {/* ── Strategy Chips (Commander's Console) ── */}
        {/* Gate: for round 3+, only show chips after mediator has appeared */}
        {chips && commanderInputEnabled && !sending && !selectedChip && (
          <div className="px-5 py-4 bg-gradient-to-r from-gray-50 to-indigo-50/30 border-t border-gray-100">
            <div className="rounded-2xl bg-white border border-indigo-100 p-4 shadow-sm">
              <p className="text-sm font-extrabold text-indigo-700 uppercase tracking-wider mb-2 text-center">
                Strategic Decision
              </p>
              <p className="text-sm font-semibold text-gray-800 mb-4 text-center leading-relaxed">{chips.question}</p>
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
          </div>
        )}

        {/* ── Selected Chip: Add optional text directive before sending ── */}
        {selectedChip && commanderInputEnabled && (
          <div className="px-5 py-4 bg-gradient-to-r from-indigo-50/40 to-gray-50 border-t border-indigo-100">
            <div className="rounded-2xl bg-white border border-indigo-100 p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex-1 text-center">
                  <p className="text-sm font-extrabold text-indigo-700 uppercase tracking-wider">Selected strategy</p>
                  <span className="inline-flex items-center gap-1.5 bg-[#1a2a3a] text-white text-xs font-semibold px-3 py-1.5 rounded-full mt-1">
                    <span className="material-icons" style={{ fontSize: 14 }}>psychology</span>
                    {selectedChip}
                  </span>
                </div>
                <button
                  onClick={() => setSelectedChip(null)}
                  disabled={sending}
                  className="text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
                  title="Change strategy"
                >
                  <span className="material-icons" style={{ fontSize: 16 }}>close</span>
                </button>
              </div>

              {attachedEvidence.length > 0 && (
                <div className="mb-3">
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 text-center">Attached evidence</p>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {attachedEvidence.map((item) => {
                      const isImage = item.type.startsWith("image/");
                      return (
                        <div key={item.uri} className="inline-flex items-center gap-1.5 bg-indigo-50 border border-indigo-200 text-indigo-700 text-[11px] font-medium px-2.5 py-1.5 rounded-full max-w-full">
                          <span className="material-icons" style={{ fontSize: 14 }}>{isImage ? "image" : "description"}</span>
                          <span className="truncate max-w-[140px]">{item.name}</span>
                          <button
                            onClick={() => removeAttachedEvidence(item.uri)}
                            className="text-indigo-500 hover:text-indigo-700"
                            title="Remove attachment"
                          >
                            <span className="material-icons" style={{ fontSize: 13 }}>close</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <p className="text-sm font-semibold text-gray-800 mb-2 text-center">Add message for your agent</p>
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
                      const directive = `[Q] ${chips?.question || ""} [CHIP] ${selectedChip} [TEXT] ${input.trim() || "-"}`;
                      setSelectedChip(null);
                      handleSend(directive);
                    }
                  }}
                  placeholder="Add legal instructions, amount, or tone (optional)..."
                  disabled={sending}
                  className="flex-1 min-w-0 bg-white border border-gray-200 rounded-full px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a2a3a]/20 focus:border-[#1a2a3a] placeholder:text-gray-400 disabled:opacity-50"
                />
                <button
                  onClick={() => {
                    const directive = `[Q] ${chips?.question || ""} [CHIP] ${selectedChip} [TEXT] ${input.trim() || "-"}`;
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
            </div>
          </div>
        )}

        {/* ── Input Bar (hidden when chip is selected — chip panel has its own input) ── */}
        {commanderInputEnabled && !selectedChip && (
          <div className="px-4 py-3 border-t border-gray-100 bg-white sticky bottom-0">
            {attachedEvidence.length > 0 && (
              <div className="mb-2">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Attached evidence</p>
                <div className="flex flex-wrap gap-2">
                  {attachedEvidence.map((item) => {
                    const isImage = item.type.startsWith("image/");
                    return (
                      <div key={item.uri} className="inline-flex items-center gap-1.5 bg-indigo-50 border border-indigo-200 text-indigo-700 text-[11px] font-medium px-2.5 py-1.5 rounded-full max-w-full">
                        <span className="material-icons" style={{ fontSize: 14 }}>{isImage ? "image" : "description"}</span>
                        <span className="truncate max-w-[140px]">{item.name}</span>
                        <button
                          onClick={() => removeAttachedEvidence(item.uri)}
                          className="text-indigo-500 hover:text-indigo-700"
                          title="Remove attachment"
                        >
                          <span className="material-icons" style={{ fontSize: 13 }}>close</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
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
                className="flex-1 min-w-0 bg-gray-50 border border-gray-200 rounded-full px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a2a3a]/20 focus:border-[#1a2a3a] placeholder:text-gray-400 disabled:opacity-50"
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

        {/* ── AI mode: Mediator wait gate ── */}
        {!isPvp && isActive && currentRound >= 3 && !mediatorShown && !sending && (
          <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 text-center">
            <p className="text-xs text-gray-500">
              Mediator intervention is being prepared. Controls will unlock after the mediator message.
            </p>
          </div>
        )}

        {/* ── PvP: Waiting for opponent's move ── */}
        {isPvp && isActive && !isMyTurn && !sending && defendantJoined && (
          <div className="px-5 py-4 bg-amber-50 border-t border-amber-200 text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <div className="relative w-4 h-4">
                <div className="absolute inset-0 border-2 border-amber-300 rounded-full" />
                <div className="absolute inset-0 border-2 border-amber-500 rounded-full border-t-transparent animate-spin" />
              </div>
              <p className="text-xs font-bold text-amber-700 uppercase tracking-wider">
                Waiting for opponent&apos;s move...
              </p>
            </div>
            <p className="text-[10px] text-amber-500">
              You&apos;ll be notified when it&apos;s your turn
            </p>
          </div>
        )}

        {/* ── PvP: Turn is being processed ── */}
        {isPvp && caseData?.turnStatus === "processing" && !sending && (
          <div className="px-5 py-3 bg-indigo-50 border-t border-indigo-100 text-center">
            <p className="text-xs text-indigo-500 animate-pulse">
              AI agents are deliberating...
            </p>
          </div>
        )}

        {/* ── Evidence Modal ── */}
        <EvidenceModal
          isOpen={showEvidence}
          onClose={() => setShowEvidence(false)}
          onValidated={handleEvidenceValidated}
          caseId={caseId}
          role={userRole}
        />

        {/* ── Invite Modal (PvP) ── */}
        {isPvp && (
          <InviteModal
            isOpen={showInviteModal}
            onClose={() => setShowInviteModal(false)}
            caseId={caseId}
            defendantJoined={defendantJoined}
            defendantDisplayName={caseData?.defendantDisplayName}
          />
        )}

        {/* ── Mobile Evidence Floating Button (draggable) ── */}
        {folderFabPos && (
          <div
            style={{ position: "fixed", left: folderFabPos.x - 24, top: folderFabPos.y - 24, zIndex: 30 }}
            onPointerDown={onFolderFabPointerDown}
            onPointerMove={onFolderFabPointerMove}
            onPointerUp={onFolderFabPointerUp}
            className="md:hidden touch-none select-none"
          >
            <button
              title="View Evidence (drag to reposition)"
              className="w-12 h-12 bg-[#1a2a3a] text-white rounded-full shadow-md flex items-center justify-center"
            >
              <span className="material-icons text-xl">folder_open</span>
            </button>
          </div>
        )}

        {/* ── Mobile Evidence Drawer ── */}
        <EvidenceSidebar
          caseId={caseId}
          side="all"
          isDrawer
          isOpen={showEvidenceDrawer}
          onClose={() => setShowEvidenceDrawer(false)}
        />

        {/* ── PDF Preview Modal ── */}
        {pdfPreview && (
          <PdfPreviewModal
            isOpen={!!pdfPreview}
            onClose={() => setPdfPreview(null)}
            htmlContent={pdfPreview.html}
            title={pdfPreview.title}
            fileName={pdfPreview.fileName}
          />
        )}
        </div>

        {/* ── Your Avatar + Evidence (desktop only, right side) ── */}
        <div className="hidden md:flex flex-col items-center gap-3 sticky top-0 h-screen pt-8 px-2">
          <div className="w-24 h-24 rounded-full bg-[#1a2a3a] text-white flex items-center justify-center shadow-lg shrink-0">
            <span className="material-icons text-4xl">person</span>
          </div>
          <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
            {userRole === "plaintiff" ? "Plaintiff" : "Defendant"}
          </span>
          <div className="w-full mt-2">
            <EvidenceSidebar
              caseId={caseId}
              side={userRole}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
