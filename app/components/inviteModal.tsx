"use client";

import React, { useState } from "react";

interface InviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  caseId: string;
  defendantJoined: boolean;
  defendantDisplayName?: string | null;
}

export default function InviteModal({
  isOpen,
  onClose,
  caseId,
  defendantJoined,
  defendantDisplayName,
}: InviteModalProps) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const inviteLink = `${typeof window !== "undefined" ? window.location.origin : ""}/negotiation/${caseId}?role=defendant`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = inviteLink;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#1a2a3a] rounded-xl flex items-center justify-center">
              <span className="material-icons text-white text-xl">person_add</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Invite Opponent</h2>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">
                PvP Negotiation
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center hover:bg-gray-100 transition-colors"
          >
            <span className="material-icons text-gray-400 text-lg">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-6 space-y-5">
          {defendantJoined ? (
            /* Defendant has joined */
            <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-center">
              <span className="material-icons text-green-500 text-3xl mb-2">check_circle</span>
              <p className="text-sm font-bold text-green-800">Opponent Connected!</p>
              <p className="text-xs text-green-600 mt-1">
                {defendantDisplayName || "Anonymous Player"} has joined the negotiation.
              </p>
            </div>
          ) : (
            <>
              {/* Instructions */}
              <div className="text-center">
                <p className="text-sm text-gray-600 leading-relaxed">
                  Share this link with the other party. They&apos;ll join as the{" "}
                  <span className="font-bold text-gray-800">defendant</span> with their own AI legal copilot.
                </p>
              </div>

              {/* Invite Link Box */}
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Invite Link
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-2.5 overflow-hidden">
                    <p className="text-xs text-gray-600 truncate font-mono">{inviteLink}</p>
                  </div>
                  <button
                    onClick={handleCopy}
                    className={`shrink-0 px-4 py-2.5 rounded-lg text-xs font-bold transition-all ${
                      copied
                        ? "bg-green-500 text-white"
                        : "bg-[#1a2a3a] text-white hover:bg-[#243447]"
                    }`}
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>

              {/* Waiting indicator */}
              <div className="flex items-center justify-center gap-2 py-3">
                <div className="relative w-4 h-4">
                  <div className="absolute inset-0 border-2 border-gray-200 rounded-full" />
                  <div className="absolute inset-0 border-2 border-indigo-500 rounded-full border-t-transparent animate-spin" />
                </div>
                <p className="text-xs text-gray-400 font-medium">
                  Waiting for opponent to join...
                </p>
              </div>

              {/* How it works */}
              <div className="border-t border-gray-100 pt-4">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">
                  How it works
                </p>
                <div className="space-y-2.5">
                  <div className="flex items-start gap-2.5">
                    <div className="w-5 h-5 bg-indigo-100 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[10px] font-bold text-indigo-600">1</span>
                    </div>
                    <p className="text-xs text-gray-500">
                      Share the invite link with the other party
                    </p>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <div className="w-5 h-5 bg-indigo-100 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[10px] font-bold text-indigo-600">2</span>
                    </div>
                    <p className="text-xs text-gray-500">
                      They join anonymously — no sign-in required
                    </p>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <div className="w-5 h-5 bg-indigo-100 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[10px] font-bold text-indigo-600">3</span>
                    </div>
                    <p className="text-xs text-gray-500">
                      Both sides get an AI legal copilot. Turns alternate.
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

