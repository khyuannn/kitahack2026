"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";

interface CaseData {
  disputeType?: string;
  caseTitle?: string;
  amount?: string;
  floorPrice?: string;
  incidentDate?: string;
  description?: string;
  evidenceFileNames?: string[];
}

export default function VerificationPage() {
  const router = useRouter();
  const { uid, isAnonymous } = useAuth();
  const [caseData, setCaseData] = useState<CaseData>({});
  const [files, setFiles] = useState<File[]>([]);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState<boolean[]>([]);
  const [allVerified, setAllVerified] = useState(false);
  const [creating, setCreating] = useState(false);
  const [serverWarming, setServerWarming] = useState(false);
  const [negotiationMode, setNegotiationMode] = useState<"ai" | "pvp">("ai");

  useEffect(() => {
    // Load case data from localStorage
    const stored = localStorage.getItem("caseData");
    if (stored) {
      setCaseData(JSON.parse(stored));
    }
    // Load files from window global (set by evidence page)
    if (typeof window !== "undefined" && (window as any).__evidenceFiles) {
      setFiles((window as any).__evidenceFiles);
    }
  }, []);

  // Auto-verify files on mount with a visual delay
  useEffect(() => {
    if (files.length > 0 && verified.length === 0) {
      setVerifying(true);
      const newVerified: boolean[] = [];

      // Simulate per-file verification with staggered timing
      files.forEach((_, index) => {
        setTimeout(() => {
          newVerified.push(true);
          setVerified([...newVerified]);
          if (newVerified.length === files.length) {
            setVerifying(false);
            setAllVerified(true);
          }
        }, 800 * (index + 1));
      });
    } else if (files.length === 0) {
      // No files — still allow proceeding
      setAllVerified(true);
    }
  }, [files]);

  const getFileIcon = (name: string) => {
    if (/\.pdf$/i.test(name)) return "picture_as_pdf";
    if (/\.(png|jpg|jpeg|webp)$/i.test(name)) return "image";
    return "description";
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const disputeTypeLabel: Record<string, string> = {
    tenancy_deposit: "Tenancy and Rental Dispute",
    consumer_ecommerce: "Consumer and E-Commerce Dispute",
    freelance_unpaid: "Freelance and Unpaid Services",
  };

  const createCaseWithRetry = async (payload: Record<string, unknown>, attempts = 15) => {
    const backendBaseUrl = process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "") || "";
    const startCaseUrl = backendBaseUrl ? `${backendBaseUrl}/api/cases/start` : "/api/cases/start";
    let lastError = "";
    for (let attempt = 1; attempt <= attempts; attempt++) {
      // Separate network errors (server unreachable) from HTTP errors (server replied with error)
      let res: Response;
      try {
        res = await fetch(startCaseUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (networkError) {
        // Server is unreachable — likely a cold start
        lastError = networkError instanceof Error ? networkError.message : String(networkError);
        if (attempt === 1) setServerWarming(true);
        if (attempt < attempts) {
          await new Promise((resolve) => setTimeout(resolve, 8000));
          continue;
        }
        throw new Error(lastError);
      }

      // Server responded — check status
      if (!res.ok) {
        const errorBody = await res.text();
        lastError = `Failed to create case (${res.status}): ${errorBody}`;
        if (attempt < attempts && res.status >= 500) {
          await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
          continue;
        }
        throw new Error(lastError);
      }

      return res;
    }
    throw new Error(lastError || "Failed to create case");
  };

  const handleStartNegotiation = async () => {
    // For PvP mode, require non-anonymous auth
    if (negotiationMode === "pvp" && (!uid || isAnonymous)) {
      alert("Please sign in with Google to create a PvP negotiation. Go back to the login page.");
      router.push("/login");
      return;
    }

    setCreating(true);
    try {
      const payload = {
        title: caseData.caseTitle || "Untitled Case",
        caseType: caseData.disputeType || "tenancy_deposit",
        description: caseData.description || "",
        amount: Number(caseData.amount) || 0,
        incidentDate: caseData.incidentDate || "",
        floorPrice: Number(caseData.floorPrice) || 0,
        mode: negotiationMode,
        createdBy: uid || undefined,
      };
      const res = await createCaseWithRetry(payload);
      const { caseId } = await res.json();

      // Upload plaintiff evidence to Firestore
      if (files.length > 0) {
        const backendBaseUrl =
          process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "") ||
          (typeof window !== "undefined" && window.location.hostname === "localhost"
            ? "http://127.0.0.1:8005"
            : "");
        const uploadUrl = backendBaseUrl
          ? `${backendBaseUrl}/api/cases/${caseId}/upload-evidence?uploaded_by=plaintiff`
          : `/api/cases/${caseId}/upload-evidence?uploaded_by=plaintiff`;

        for (const file of files) {
          const formData = new FormData();
          formData.append("file", file);
          formData.append("user_claim", `Plaintiff evidence: ${file.name}`);
          formData.append("uploaded_by", "plaintiff");
          try {
            await fetch(uploadUrl, { method: "POST", body: formData });
          } catch {
            // Non-fatal: continue even if one file fails
          }
        }
      }

      // Clean up
      localStorage.removeItem("caseData");
      if (typeof window !== "undefined") {
        delete (window as any).__evidenceFiles;
      }

      router.push(`/negotiation/${caseId}?role=plaintiff`);
    } catch (error) {
      console.error("Failed to create case:", error);
      setCreating(false);
      setServerWarming(false);
    }
  };

  return (
    <div className="bg-off-white min-h-screen font-sans antialiased text-gray-900 pb-40">
      <div className="w-full">
        {/* Header */}
        <header className="px-6 py-5 border-b border-gray-100 flex items-center gap-4 bg-white sticky top-0 z-10">
          <div className="w-10 h-10 bg-[#1a1a1a] rounded-lg flex items-center justify-center shrink-0">
            <span className="material-icons text-white text-xl">balance</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-black tracking-wide">Lex-Machina</h1>
        </header>

        <main className="max-w-5xl mx-auto px-6 pt-8 pb-8">
          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-4">
            <span className="bg-black text-white text-xs font-bold px-2 py-1 rounded tracking-wide">
              Step 4
            </span>
            <span className="text-xs font-semibold text-gray-400 tracking-wide">
              Of 4
            </span>
          </div>

          {/* Back link */}
          <button
            onClick={() => router.push("/case/new/evidence")}
            className="inline-flex items-center text-text-secondary-light text-xs font-semibold mb-6 hover:text-primary transition-colors uppercase tracking-wide"
          >
            <span className="material-icons text-sm mr-1">arrow_back</span>
            Back to Upload
          </button>

          <div className="mb-8">
            <h2 className="font-display text-4xl font-bold text-gray-900 mb-2 leading-tight">
              Verify Evidence
            </h2>
            <p className="text-text-secondary-light text-sm font-normal">
              Review your case details and evidence
            </p>
          </div>

          {/* Case Summary Card */}
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 mb-6">
            <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-4">
              Case Summary
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-xs text-gray-400 font-medium">Type</span>
                <span className="text-xs font-semibold text-gray-700">
                  {disputeTypeLabel[caseData.disputeType || ""] || caseData.disputeType || "—"}
                </span>
              </div>
              <div className="h-[1px] bg-gray-100"></div>
              <div className="flex justify-between">
                <span className="text-xs text-gray-400 font-medium">Title</span>
                <span className="text-xs font-semibold text-gray-700 text-right max-w-[200px]">
                  {caseData.caseTitle || "—"}
                </span>
              </div>
              <div className="h-[1px] bg-gray-100"></div>
              <div className="flex justify-between">
                <span className="text-xs text-gray-400 font-medium">Amount</span>
                <span className="text-xs font-semibold text-gray-700">
                  {caseData.amount ? `RM ${caseData.amount}` : "—"}
                </span>
              </div>
              <div className="h-[1px] bg-gray-100"></div>
              <div className="flex justify-between">
                <span className="text-xs text-gray-400 font-medium">Date</span>
                <span className="text-xs font-semibold text-gray-700">
                  {caseData.incidentDate || "—"}
                </span>
              </div>
              {caseData.description && (
                <>
                  <div className="h-[1px] bg-gray-100"></div>
                  <div>
                    <span className="text-xs text-gray-400 font-medium block mb-1">Description</span>
                    <p className="text-xs text-gray-700 leading-relaxed">{caseData.description}</p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Evidence Verification */}
          <div className="mb-6">
            <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-4">
              Evidence Files ({files.length})
            </h3>

            {files.length === 0 ? (
              <div className="bg-gray-50 rounded-xl p-6 text-center border border-gray-100">
                <span className="material-icons text-3xl text-gray-300 mb-2">folder_open</span>
                <p className="text-sm text-gray-400">No evidence files uploaded</p>
              </div>
            ) : (
              <div className="space-y-3">
                {files.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-3 bg-gray-50 rounded-xl p-4 border border-gray-100"
                  >
                    <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600 shrink-0">
                      <span className="material-icons text-xl">{getFileIcon(file.name)}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                      <p className="text-xs text-gray-400">{formatSize(file.size)}</p>
                    </div>
                    <div className="shrink-0">
                      {index < verified.length ? (
                        <div className="flex items-center gap-1 bg-green-100 text-green-700 text-[10px] font-bold px-2.5 py-1 rounded-full">
                          <span className="material-icons text-xs">check_circle</span>
                          Verified
                        </div>
                      ) : verifying ? (
                        <div className="flex items-center gap-1 bg-yellow-100 text-yellow-700 text-[10px] font-bold px-2.5 py-1 rounded-full">
                          <span className="material-icons text-xs animate-spin">sync</span>
                          Checking
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 bg-gray-100 text-gray-500 text-[10px] font-bold px-2.5 py-1 rounded-full">
                          <span className="material-icons text-xs">schedule</span>
                          Pending
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Verification status */}
          {allVerified && files.length > 0 && (
            <div className="bg-green-50 rounded-xl p-5 flex gap-3 items-start mb-6">
              <span className="material-icons text-green-600 text-xl shrink-0">verified</span>
              <div>
                <h4 className="text-xs font-bold uppercase text-green-800 mb-1 tracking-wide">
                  All Evidence Verified
                </h4>
                <p className="text-xs text-green-600 leading-relaxed">
                  All uploaded files have passed validation checks. File types and sizes are within
                  acceptable limits.
                </p>
              </div>
            </div>
          )}

          {/* Negotiation Mode Toggle */}
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 mb-6">
            <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-4">
              Negotiation Mode
            </h3>
            <div className="space-y-3">
              <button
                onClick={() => setNegotiationMode("ai")}
                className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all ${
                  negotiationMode === "ai"
                    ? "border-[#1a2a3a]/30 bg-[#1a2a3a]/5"
                    : "border-gray-100 hover:border-gray-200"
                }`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                  negotiationMode === "ai" ? "bg-[#1a2a3a] text-white" : "bg-gray-100 text-gray-500"
                }`}>
                  <span className="material-icons text-xl">smart_toy</span>
                </div>
                <div className="text-left flex-1">
                  <p className={`text-sm font-bold ${negotiationMode === "ai" ? "text-[#1a2a3a]" : "text-gray-700"}`}>
                    AI Mock Negotiation
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    Practice against an AI opponent. Perfect for testing your strategy.
                  </p>
                </div>
                {negotiationMode === "ai" && (
                  <span className="material-icons text-[#1a2a3a]">check_circle</span>
                )}
              </button>

              <button
                onClick={() => setNegotiationMode("pvp")}
                className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all ${
                  negotiationMode === "pvp"
                    ? "border-[#1a2a3a]/30 bg-[#1a2a3a]/5"
                    : "border-gray-100 hover:border-gray-200"
                }`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                  negotiationMode === "pvp" ? "bg-[#1a2a3a] text-white" : "bg-gray-100 text-gray-500"
                }`}>
                  <span className="material-icons text-xl">group</span>
                </div>
                <div className="text-left flex-1">
                  <p className={`text-sm font-bold ${negotiationMode === "pvp" ? "text-[#1a2a3a]" : "text-gray-700"}`}>
                    Negotiate with a Real Person
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    Invite another party to negotiate. Both sides get an AI legal copilot.
                  </p>
                </div>
                {negotiationMode === "pvp" && (
                  <span className="material-icons text-[#1a2a3a]">check_circle</span>
                )}
              </button>
            </div>

            {negotiationMode === "pvp" && (!uid || isAnonymous) && (
              <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                <span className="material-icons text-amber-500 text-lg shrink-0 mt-0.5">warning</span>
                <p className="text-[11px] text-amber-700">
                  PvP mode requires Google sign-in. You&apos;ll be redirected to sign in when you proceed.
                </p>
              </div>
            )}
          </div>

        </main>

        <footer className="fixed bottom-0 left-0 right-0 z-20 border-t border-gray-100 bg-white/95 backdrop-blur-sm">
          <div className="max-w-5xl mx-auto px-6 py-4">
            {serverWarming && creating && (
              <div className="mb-3 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                <span className="material-icons text-amber-500 text-base shrink-0 mt-0.5 animate-spin">sync</span>
                <p className="text-xs text-amber-700 leading-relaxed">
                  Server is starting up (free hosting). This may take up to 60 seconds — please keep this page open.
                </p>
              </div>
            )}
            <button
              onClick={handleStartNegotiation}
              disabled={!allVerified || creating}
              className={`w-full font-semibold py-3.5 px-6 rounded-lg flex items-center justify-center gap-2 shadow-sm transition-all duration-200 group ${
                !allVerified || creating
                  ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                  : "bg-[#1a2a3a] hover:bg-[#243447] text-white"
              }`}
            >
              <span className="text-base">
                {creating
                  ? serverWarming
                    ? "Server warming up..."
                    : "Creating Case..."
                  : "Start Negotiation"}
              </span>
              {!creating && (
                <span className="material-icons text-lg group-hover:translate-x-1 transition-transform">
                  arrow_forward
                </span>
              )}
            </button>
            <div className="mt-3 flex justify-center gap-8 mb-2">
              <a className="text-[10px] font-semibold text-gray-400 hover:text-primary transition-colors" href="#">
                Privacy Policy
              </a>
              <a className="text-[10px] font-semibold text-gray-400 hover:text-primary transition-colors" href="#">
                Terms of Service
              </a>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-gray-400">© 2026 Lex-Machina</p>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
