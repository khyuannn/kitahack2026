"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function CaseDetailsPage() {
  const router = useRouter();
  const [caseTitle, setCaseTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [incidentDate, setIncidentDate] = useState("");
  const [description, setDescription] = useState("");
  const [floorPrice, setFloorPrice] = useState("");
  const [disputeType, setDisputeType] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem("caseData");
    if (stored) {
      const data = JSON.parse(stored);
      setDisputeType(data.disputeType || "");
    }
  }, []);

  const handleContinue = () => {
    const stored = localStorage.getItem("caseData");
    const existing = stored ? JSON.parse(stored) : {};
    localStorage.setItem(
      "caseData",
      JSON.stringify({
        ...existing,
        caseTitle,
        amount,
        incidentDate,
        description,
        floorPrice,
      })
    );
    router.push("/case/new/evidence");
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
              Step 2
            </span>
            <span className="text-xs font-medium text-text-secondary-light uppercase tracking-wide">
              Of 4
            </span>
          </div>

          {/* Back link */}
          <button
            onClick={() => router.push("/case/new")}
            className="inline-flex items-center text-text-secondary-light text-xs font-semibold mb-6 hover:text-primary transition-colors uppercase tracking-wide"
          >
            <span className="material-icons text-sm mr-1">arrow_back</span>
            Back to Types
          </button>

          <div className="mb-8">
            <h2 className="font-display text-4xl font-bold text-gray-900 mb-2 leading-tight">
              Create New Case
            </h2>
            <p className="text-text-secondary-light text-sm font-normal">
              Enter the detailed information
            </p>
          </div>

          {/* Form */}
          <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
            <div className="space-y-2">
              <label className="block text-xs font-bold text-gray-900 uppercase tracking-wide" htmlFor="case-title">
                Case Title
              </label>
              <input
                className="w-full px-4 py-3 bg-white border border-gray-200 text-gray-900 text-sm rounded-sm focus:ring-1 focus:ring-primary focus:border-primary placeholder-gray-400 transition-shadow outline-none"
                id="case-title"
                placeholder="e.g. Bangsar South Condo Deposit Dispute"
                type="text"
                value={caseTitle}
                onChange={(e) => setCaseTitle(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-bold text-gray-900 uppercase tracking-wide" htmlFor="amount">
                Dispute Amount (RM)
              </label>
              <input
                className="w-full px-4 py-3 bg-white border border-gray-200 text-gray-900 text-sm rounded-sm focus:ring-1 focus:ring-primary focus:border-primary transition-shadow outline-none"
                id="amount"
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-bold text-gray-900 uppercase tracking-wide" htmlFor="floor-price">
                Floor Price (RM)
              </label>
              <input
                className="w-full px-4 py-3 bg-white border border-gray-200 text-gray-900 text-sm rounded-sm focus:ring-1 focus:ring-primary focus:border-primary placeholder-gray-400 transition-shadow outline-none"
                id="floor-price"
                type="text"
                placeholder="Your minimum acceptable settlement"
                value={floorPrice}
                onChange={(e) => setFloorPrice(e.target.value)}
              />
              <p className="text-[10px] text-gray-400 mt-1">
                Hidden from the other party. The AI will try to settle at or above this amount.
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-bold text-gray-900 uppercase tracking-wide" htmlFor="date">
                Incident Date (DD/MM/YY)
              </label>
              <input
                className="w-full px-4 py-3 bg-white border border-gray-200 text-gray-900 text-sm rounded-sm focus:ring-1 focus:ring-primary focus:border-primary transition-shadow outline-none"
                id="date"
                type="text"
                value={incidentDate}
                onChange={(e) => setIncidentDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-bold text-gray-900 uppercase tracking-wide" htmlFor="description">
                Short Description
              </label>
              <textarea
                className="w-full px-4 py-3 bg-white border border-gray-200 text-gray-900 text-sm rounded-sm focus:ring-1 focus:ring-primary focus:border-primary placeholder-gray-400 transition-shadow outline-none resize-none"
                id="description"
                placeholder="Briefly explain what happened..."
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </form>

          {/* Disclaimer */}
          <div className="mt-10 mb-6 text-center px-4">
            <p className="text-[10px] leading-tight text-gray-400 text-center">
              By initializing, you agree to our standard terms. No legal privilege created until retainer.
            </p>
          </div>

          {/* Continue Button */}
          <button
            onClick={handleContinue}
            className="w-full bg-[#1a2a3a] hover:bg-[#243447] text-white font-semibold py-4 px-6 rounded-lg shadow-lg hover:shadow-xl transition-all duration-200 flex items-center justify-center gap-2 group"
          >
            <span className="text-base">Upload Evidence</span>
            <span className="material-icons text-white text-lg group-hover:translate-x-1 transition-transform">
              arrow_forward
            </span>
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
