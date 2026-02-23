"use client";

import React, { useState, useEffect } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/firebase/config";

interface EvidenceDoc {
  id: string;
  fileName?: string;
  fileType?: string;
  storageUrl?: string;
  extractedText?: string;
  uploadedBy?: string;
}

interface EvidenceSidebarProps {
  caseId: string;
  side: "plaintiff" | "defendant" | "all";
  isDrawer?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}

export default function EvidenceSidebar({
  caseId,
  side,
  isDrawer = false,
  isOpen = false,
  onClose,
}: EvidenceSidebarProps) {
  const [evidence, setEvidence] = useState<EvidenceDoc[]>([]);

  useEffect(() => {
    if (!caseId) return;

    const unsub = onSnapshot(
      collection(db, "cases", caseId, "evidence"),
      (snap) => {
        console.log(`[EvidenceSidebar] snapshot fired: ${snap.docs.length} docs, side="${side}"`);
        const docs: EvidenceDoc[] = [];
        snap.forEach((d) => {
          const data = d.data();
          console.log(`[EvidenceSidebar] doc ${d.id}:`, JSON.stringify({ uploadedBy: data.uploadedBy, fileName: data.fileName }));
          const uploadedBy: string | undefined = data.uploadedBy;
          if (side === "all") {
            // Show all evidence in "all" mode; label as "unknown" if untagged
            docs.push({ id: d.id, ...data, uploadedBy: uploadedBy || "unknown" } as EvidenceDoc);
          } else if (uploadedBy === side) {
            docs.push({ id: d.id, ...data, uploadedBy } as EvidenceDoc);
          }
          // Evidence without uploadedBy is excluded from role-specific views
        });
        console.log(`[EvidenceSidebar] matched docs: ${docs.length}`);
        setEvidence(docs);
      },
      (error) => {
        console.error("[EvidenceSidebar] Firestore read failed:", error.code, error.message);
      }
    );

    return () => unsub();
  }, [caseId, side]);

  const getIcon = (fileType?: string, fileName?: string) => {
    if (fileType?.startsWith("image") || /\.(png|jpg|jpeg|webp)$/i.test(fileName || ""))
      return "image";
    if (fileType?.includes("pdf") || /\.pdf$/i.test(fileName || ""))
      return "picture_as_pdf";
    return "description";
  };

  const isImage = (fileType?: string, fileName?: string) => {
    return (
      fileType?.startsWith("image") ||
      /\.(png|jpg|jpeg|webp)$/i.test(fileName || "")
    );
  };

  const content = (
    <div className="space-y-2">
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-1">
        {side === "all"
          ? "All Evidence"
          : side === "plaintiff"
          ? "Plaintiff Evidence"
          : "Defendant Evidence"}
        {evidence.length > 0 && ` (${evidence.length})`}
      </p>
      {evidence.length === 0 ? (
        <div className="text-center py-4">
          <span className="material-icons text-gray-300 text-2xl block mb-1">
            folder_open
          </span>
          <p className="text-[10px] text-gray-400">No evidence uploaded</p>
        </div>
      ) : (
        evidence.map((ev) => (
          <div
            key={ev.id}
            className="bg-gray-50 rounded-lg p-2.5 border border-gray-100 hover:border-gray-200 transition-colors"
          >
            {isImage(ev.fileType, ev.fileName) && ev.storageUrl ? (
              <div className="w-full h-16 bg-gray-200 rounded-md mb-2 overflow-hidden flex items-center justify-center">
                <span className="material-icons text-gray-400 text-3xl">
                  image
                </span>
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-blue-50 rounded-md flex items-center justify-center text-blue-600 shrink-0">
                <span className="material-icons" style={{ fontSize: 16 }}>
                  {getIcon(ev.fileType, ev.fileName)}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-gray-800 truncate">
                  {ev.fileName || "Evidence"}
                </p>
                {ev.extractedText && (
                  <p className="text-[9px] text-gray-400 truncate">
                    {ev.extractedText.slice(0, 50)}
                  </p>
                )}
              </div>
            </div>
            {side === "all" && ev.uploadedBy && ev.uploadedBy !== "unknown" && (
              <span
                className={`inline-block mt-1.5 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                  ev.uploadedBy === "plaintiff"
                    ? "bg-blue-50 text-blue-500"
                    : "bg-amber-50 text-amber-600"
                }`}
              >
                {ev.uploadedBy}
              </span>
            )}
          </div>
        ))
      )}
    </div>
  );

  // Drawer mode (mobile)
  if (isDrawer) {
    return (
      <>
        {/* Backdrop */}
        {isOpen && (
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={onClose}
          />
        )}
        {/* Slide-in panel */}
        <div
          className={`fixed top-0 right-0 h-full w-72 bg-white shadow-2xl z-50 transform transition-transform duration-300 ${
            isOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-bold text-gray-900">Evidence</h3>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center hover:bg-gray-100"
            >
              <span className="material-icons text-lg text-gray-600">
                close
              </span>
            </button>
          </div>
          <div className="p-3 overflow-y-auto" style={{ maxHeight: "calc(100vh - 56px)" }}>
            {content}
          </div>
        </div>
      </>
    );
  }

  // Desktop sidebar mode
  return (
    <div className="w-full overflow-y-auto" style={{ maxHeight: "60vh" }}>
      {content}
    </div>
  );
}
