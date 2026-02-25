"use client";

import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { doc, onSnapshot, collection, getDocs } from "firebase/firestore";
import { db } from "@/firebase/config";
import { useAuth } from "@/hooks/useAuth";

interface CaseData {
  title?: string;
  caseType?: string;
  amount?: number;
  description?: string;
  incidentDate?: string;
  mode?: string;
  defendantResponded?: boolean;
  defendantUserId?: string;
  plaintiffUserId?: string;
}

interface EvidenceDoc {
  id: string;
  fileName?: string;
  fileType?: string;
  storageUrl?: string;
  extractedText?: string;
  uploadedBy?: string;
}

export default function DefendantRespondPage() {
  const params = useParams();
  const router = useRouter();
  const rawCaseId = params.caseId;
  const caseId = Array.isArray(rawCaseId) ? rawCaseId[0] : (rawCaseId as string | undefined);

  const {
    uid,
    loading: authLoading,
    signInAnonymously: doAnonSignIn,
  } = useAuth();

  const [caseData, setCaseData] = useState<CaseData | null>(null);
  const [caseLoading, setCaseLoading] = useState(true);
  const [plaintiffEvidence, setPlaintiffEvidence] = useState<EvidenceDoc[]>([]);

  // Form state
  const [defendantDescription, setDefendantDescription] = useState("");
  const [startingOffer, setStartingOffer] = useState("");
  const [ceilingPrice, setCeilingPrice] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto sign-in
  useEffect(() => {
    if (authLoading || uid) return;
    doAnonSignIn().catch((err) =>
      console.error("Anonymous sign-in failed:", err)
    );
  }, [authLoading, uid, doAnonSignIn]);

  // Load case data
  useEffect(() => {
    if (!caseId || !uid) return;

    const unsub = onSnapshot(doc(db, "cases", caseId), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as CaseData;
        setCaseData(data);

        // If already responded, redirect to negotiation
        if (data.defendantResponded && data.defendantUserId === uid) {
          router.replace(`/negotiation/${caseId}?role=defendant`);
        }
      }
      setCaseLoading(false);
    });

    return () => unsub();
  }, [caseId, uid, router]);

  // Load plaintiff evidence
  useEffect(() => {
    if (!caseId || !uid) return;

    const loadEvidence = async () => {
      const evidenceRef = collection(db, "cases", caseId, "evidence");
      const snap = await getDocs(evidenceRef);
      const docs: EvidenceDoc[] = [];
      snap.forEach((d) => {
        const data = d.data();
        // Show plaintiff evidence (uploadedBy is absent or "plaintiff")
        if (!data.uploadedBy || data.uploadedBy === "plaintiff") {
          docs.push({ id: d.id, ...data } as EvidenceDoc);
        }
      });
      setPlaintiffEvidence(docs);
    };

    loadEvidence();
  }, [caseId, uid]);

  const handleFiles = (newFiles: FileList | null) => {
    if (!newFiles) return;
    const allowed = Array.from(newFiles).filter(
      (f) =>
        /\.(pdf|txt|md|png|jpg|jpeg|webp)$/i.test(f.name) &&
        f.size <= 5 * 1024 * 1024
    );
    setFiles((prev) => [...prev, ...allowed]);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const getFileIcon = (name: string) => {
    if (/\.pdf$/i.test(name)) return "picture_as_pdf";
    if (/\.(png|jpg|jpeg|webp)$/i.test(name)) return "image";
    return "description";
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (!caseId) {
      setError("Invalid case link. Please open the invite link again.");
      return;
    }

    const backendBaseUrl =
      process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "") ||
      (typeof window !== "undefined" && window.location.hostname === "localhost"
        ? "http://127.0.0.1:8005"
        : "");

    const uploadEvidenceUrl = backendBaseUrl
      ? `${backendBaseUrl}/api/cases/${caseId}/upload-evidence`
      : `/api/cases/${caseId}/upload-evidence`;

    const defendantRespondUrl = backendBaseUrl
      ? `${backendBaseUrl}/api/cases/${caseId}/defendant-respond`
      : `/api/cases/${caseId}/defendant-respond`;

    const joinUrl = backendBaseUrl
      ? `${backendBaseUrl}/api/cases/${caseId}/join`
      : `/api/cases/${caseId}/join`;

    setSubmitting(true);
    setError(null);

    try {
      let currentUid = uid;
      if (!currentUid) {
        const anonUser = await doAnonSignIn();
        currentUid = anonUser?.uid ?? null;
      }
      if (!currentUid) throw new Error("Failed to authenticate");

      // Upload evidence files first
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append(
          "user_claim",
          `Defendant evidence: ${file.name}`
        );
        formData.append("uploaded_by", "defendant");

        const uploadRes = await fetch(
          uploadEvidenceUrl,
          { method: "POST", body: formData }
        );

        if (uploadRes.ok) {
          // Mark evidence as uploaded by defendant in Firestore
          // (The backend upload-evidence endpoint saves the doc; we just tag it)
        }
      }

      // Submit defendant response
      let res = await fetch(defendantRespondUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: currentUid,
          defendantDescription,
          defendantCeilingPrice: ceilingPrice ? parseFloat(ceilingPrice) : null,
          defendantStartingOffer: startingOffer
            ? parseFloat(startingOffer)
            : null,
          isAnonymous: true,
          displayName: "Anonymous Defendant",
        }),
      });

      if (res.status === 404) {
        res = await fetch(joinUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: currentUid,
            role: "defendant",
            isAnonymous: true,
            displayName: "Anonymous Defendant",
          }),
        });
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to submit response");
      }

      const responseData = await res.json().catch(() => ({}));
      const nextCaseId = responseData.caseId || caseId;

      if (typeof window !== "undefined") {
        sessionStorage.setItem(
          `pendingDefendantOpening:${nextCaseId}`,
          JSON.stringify({
            content: defendantDescription.trim(),
            offer: startingOffer ? Number(startingOffer) : null,
          })
        );
      }

      // Redirect to negotiation
      router.replace(`/negotiation/${nextCaseId}?role=defendant`);
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const caseTypeLabels: Record<string, string> = {
    tenancy_deposit: "Tenancy Deposit",
    consumer_ecommerce: "Consumer / E-Commerce",
    freelance_unpaid: "Freelance Unpaid Work",
  };

  if (caseLoading || authLoading) {
    return (
      <div className="bg-off-white min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <span className="material-icons text-4xl text-gray-300 animate-pulse">
            balance
          </span>
          <p className="text-sm text-gray-400 font-medium">Loading case...</p>
        </div>
      </div>
    );
  }

  if (!caseData) {
    return (
      <div className="bg-off-white min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <span className="material-icons text-4xl text-red-400">error</span>
          <p className="text-sm text-red-600 font-medium">Case not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-off-white min-h-screen font-sans antialiased text-gray-900 flex justify-center">
      <div className="w-full max-w-md md:max-w-2xl lg:max-w-3xl bg-white min-h-screen shadow-2xl relative flex flex-col">
        {/* Header */}
        <header className="px-6 py-5 border-b border-gray-200 flex items-center gap-4 bg-white sticky top-0 z-10">
          <div className="w-10 h-10 bg-[#1a1a1a] rounded-lg flex items-center justify-center shrink-0">
            <span className="material-icons text-white text-xl">balance</span>
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-xl font-bold text-black tracking-wide">
              LexSuluh
            </h1>
            <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">
              Defendant Response
            </p>
          </div>
        </header>

        <main className="flex-1 px-6 pt-8 pb-12 overflow-y-auto space-y-8">
          {/* Section 1: Case Summary (Read-Only) */}
          <section>
            <h2 className="font-display text-2xl font-bold text-gray-900 mb-2">
              Case Summary
            </h2>
            <p className="text-xs text-gray-400 mb-4">
              Review the details of the claim filed against you
            </p>
            <div className="bg-gray-50 rounded-xl p-5 border border-gray-100 space-y-3">
              <div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                  Title
                </span>
                <p className="text-sm font-semibold text-gray-900">
                  {caseData.title || "Untitled Case"}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    Type
                  </span>
                  <p className="text-sm text-gray-700">
                    {caseTypeLabels[caseData.caseType || ""] ||
                      caseData.caseType}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    Amount Claimed
                  </span>
                  <p className="text-sm font-semibold text-gray-900">
                    RM {(caseData.amount || 0).toLocaleString()}
                  </p>
                </div>
              </div>
              {caseData.incidentDate && (
                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    Incident Date
                  </span>
                  <p className="text-sm text-gray-700">
                    {caseData.incidentDate}
                  </p>
                </div>
              )}
              {caseData.description && (
                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    Description
                  </span>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">
                    {caseData.description}
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* Section 2: Plaintiff Evidence (Read-Only) */}
          {plaintiffEvidence.length > 0 && (
            <section>
              <h2 className="text-lg font-bold text-gray-900 mb-2">
                Plaintiff&apos;s Evidence
              </h2>
              <p className="text-xs text-gray-400 mb-3">
                Documents submitted by the plaintiff
              </p>
              <div className="space-y-2">
                {plaintiffEvidence.map((ev) => (
                  <div
                    key={ev.id}
                    className="flex items-center gap-3 bg-gray-50 rounded-xl p-3 border border-gray-100"
                  >
                    <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600 shrink-0">
                      <span className="material-icons text-lg">
                        {ev.fileType?.startsWith("image")
                          ? "image"
                          : ev.fileType?.includes("pdf")
                          ? "picture_as_pdf"
                          : "description"}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {ev.fileName || "Evidence file"}
                      </p>
                      {ev.extractedText && (
                        <p className="text-xs text-gray-400 truncate">
                          {ev.extractedText.slice(0, 80)}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Section 3: Your Response */}
          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">
              Your Response
            </h2>
            <p className="text-xs text-gray-400 mb-3">
              Describe your side of the dispute
            </p>
            <textarea
              value={defendantDescription}
              onChange={(e) => setDefendantDescription(e.target.value)}
              placeholder="Explain your perspective on this dispute. Include any relevant facts, timeline of events, and why you believe the claim is unjustified or should be reduced..."
              rows={5}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a2a3a]/20 focus:border-[#1a2a3a] placeholder:text-gray-400 resize-none"
            />
          </section>

          {/* Section 4: Evidence Upload */}
          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">
              Upload Your Evidence
            </h2>
            <p className="text-xs text-gray-400 mb-3">
              Attach supporting documents for your defense (optional)
            </p>
            <div
              className={`border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer ${
                dragActive
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 hover:border-gray-300 bg-gray-50"
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                handleFiles(e.dataTransfer.files);
              }}
              onClick={() =>
                document.getElementById("defendant-file-input")?.click()
              }
            >
              <span className="material-icons text-2xl text-gray-400 mb-2 block">
                cloud_upload
              </span>
              <p className="text-sm font-semibold text-gray-700 mb-1">
                Drag & drop files here
              </p>
              <p className="text-xs text-gray-400">
                PDF, TXT, MD, PNG, JPG, JPEG, WEBP &middot; Max 5 MB
              </p>
              <input
                id="defendant-file-input"
                type="file"
                className="hidden"
                multiple
                accept=".pdf,.txt,.md,.png,.jpg,.jpeg,.webp"
                onChange={(e) => handleFiles(e.target.files)}
              />
            </div>

            {files.length > 0 && (
              <div className="mt-3 space-y-2">
                {files.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-3 bg-gray-50 rounded-xl p-3 border border-gray-100"
                  >
                    <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600 shrink-0">
                      <span className="material-icons text-lg">
                        {getFileIcon(file.name)}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {file.name}
                      </p>
                      <p className="text-xs text-gray-400">
                        {formatSize(file.size)}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile(index);
                      }}
                      className="text-gray-400 hover:text-red-500 transition-colors shrink-0"
                    >
                      <span className="material-icons text-lg">close</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Section 5: Offers */}
          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">
              Your Offers
            </h2>
            <p className="text-xs text-gray-400 mb-3">
              Set your negotiation parameters
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                  Starting Offer (RM)
                </label>
                <input
                  type="number"
                  value={startingOffer}
                  onChange={(e) => setStartingOffer(e.target.value)}
                  placeholder="e.g. 500"
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a2a3a]/20 focus:border-[#1a2a3a] placeholder:text-gray-400"
                />
                <p className="text-[10px] text-gray-400 mt-1">
                  Your AI agent will start negotiations at this amount
                </p>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                  Maximum Amount (RM)
                  <span className="text-amber-500 ml-1">Hidden</span>
                </label>
                <input
                  type="number"
                  value={ceilingPrice}
                  onChange={(e) => setCeilingPrice(e.target.value)}
                  placeholder="e.g. 1500"
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a2a3a]/20 focus:border-[#1a2a3a] placeholder:text-gray-400"
                />
                <p className="text-[10px] text-gray-400 mt-1">
                  Max you&apos;re willing to pay. Hidden from the plaintiff.
                </p>
              </div>
            </div>
          </section>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <p className="text-sm text-red-600 font-medium">{error}</p>
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={submitting || !defendantDescription.trim()}
            className={`w-full font-semibold py-4 px-6 rounded-lg flex items-center justify-center gap-2 shadow-lg transition-all duration-200 group ${
              submitting || !defendantDescription.trim()
                ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                : "bg-[#1a2a3a] hover:bg-[#243447] text-white hover:shadow-xl"
            }`}
          >
            {submitting ? (
              <>
                <div className="relative w-5 h-5">
                  <div className="absolute inset-0 border-2 border-white/30 rounded-full" />
                  <div className="absolute inset-0 border-2 border-white rounded-full border-t-transparent animate-spin" />
                </div>
                <span>Submitting...</span>
              </>
            ) : (
              <>
                <span className="text-base">Submit Response & Join Negotiation</span>
                <span className="material-icons text-lg group-hover:translate-x-1 transition-transform">
                  arrow_forward
                </span>
              </>
            )}
          </button>
        </main>

        {/* Footer */}
        <footer className="py-6 border-t border-gray-100 mt-auto bg-white">
          <div className="text-center">
            <p className="text-[10px] text-gray-400">
              &copy; 2026 LexSuluh &middot; AI-Powered Dispute Resolution
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
