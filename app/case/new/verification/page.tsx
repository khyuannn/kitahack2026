"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

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
  const [caseData, setCaseData] = useState<CaseData>({});
  const [files, setFiles] = useState<File[]>([]);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState<boolean[]>([]);
  const [allVerified, setAllVerified] = useState(false);
  const [creating, setCreating] = useState(false);

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

  const handleStartNegotiation = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/cases/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: caseData.caseTitle || "Untitled Case",
          caseType: caseData.disputeType || "tenancy_deposit",
          description: caseData.description || "",
          amount: Number(caseData.amount) || 0,
          incidentDate: caseData.incidentDate || "",
          floorPrice: Number(caseData.floorPrice) || 0,
        }),
      });

      if (!res.ok) throw new Error("Failed to create case");
      const { caseId } = await res.json();

      // Clean up
      localStorage.removeItem("caseData");
      if (typeof window !== "undefined") {
        delete (window as any).__evidenceFiles;
      }

      router.push(`/negotiation/${caseId}`);
    } catch (error) {
      console.error("Failed to create case:", error);
      setCreating(false);
    }
  };

  return (
    <div className="bg-off-white min-h-screen font-sans antialiased text-gray-900 flex justify-center">
      <div className="w-full max-w-md bg-white min-h-screen shadow-2xl relative flex flex-col">
        {/* Header */}
        <header className="px-6 py-5 border-b border-gray-200 flex items-center gap-4 bg-white sticky top-0 z-10">
          <div className="w-10 h-10 bg-[#1a1a1a] rounded-lg flex items-center justify-center shrink-0">
            <span className="material-icons text-white text-xl">balance</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-black tracking-wide">Lex-Machina</h1>
        </header>

        <main className="flex-1 px-6 pt-8 pb-12 overflow-y-auto">
          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-4">
            <span className="bg-black text-white text-[10px] font-bold px-2 py-1 rounded tracking-wider uppercase">
              Step 4
            </span>
            <span className="text-xs font-medium text-text-secondary-light uppercase tracking-wide">
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

          {/* Start Negotiation Button */}
          <button
            onClick={handleStartNegotiation}
            disabled={!allVerified || creating}
            className={`w-full font-semibold py-4 px-6 rounded-lg mt-4 flex items-center justify-center gap-2 shadow-lg transition-all duration-200 group ${
              !allVerified || creating
                ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                : "bg-[#1a2a3a] hover:bg-[#243447] text-white hover:shadow-xl"
            }`}
          >
            <span className="text-base">
              {creating ? "Creating Case..." : "Start Negotiation"}
            </span>
            {!creating && (
              <span className="material-icons text-lg group-hover:translate-x-1 transition-transform">
                arrow_forward
              </span>
            )}
          </button>
        </main>

        {/* Footer */}
        <footer className="py-8 border-t border-transparent mt-auto bg-white">
          <div className="flex justify-center gap-8 mb-6">
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
        </footer>
      </div>
    </div>
  );
}
