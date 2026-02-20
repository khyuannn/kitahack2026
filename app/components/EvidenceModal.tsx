"use client";

import { useState } from "react";

interface EvidenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onValidated: (fileUri: string, fileName: string, fileType: string) => void;
  caseId: string;
}

export default function EvidenceModal({
  isOpen,
  onClose,
  onValidated,
  caseId,
}: EvidenceModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [userClaim, setUserClaim] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    if (selected.size > 5 * 1024 * 1024) {
      alert("File must be ≤ 5MB");
      return;
    }

    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "application/pdf",
    ];

    if (!allowedTypes.includes(selected.type)) {
      setError("Only JPG, PNG, or PDF allowed.");
      return;
    }

    setError(null);
    setFile(selected);
  };

  const handleUpload = async () => {
    if (!file) return;

    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("user_claim", userClaim || `Evidence: ${file.name}`);

      const res = await fetch(`/api/cases/${caseId}/upload-evidence`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Validation failed");
      }

      onValidated(data.file_uri, file.name, file.type);
      setFile(null);
      setUserClaim("");
      onClose();

    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
      <div className="bg-white p-6 rounded-2xl w-96 shadow-xl mx-4">
        <h2 className="text-lg font-bold mb-4">Upload Evidence</h2>

        <input
          type="file"
          accept=".jpg,.jpeg,.png,.pdf"
          onChange={handleFileChange}
          className="mb-3 w-full text-sm"
        />

        {file && (
          <input
            type="text"
            value={userClaim}
            onChange={(e) => setUserClaim(e.target.value)}
            placeholder="Describe what this evidence shows..."
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-[#1a2a3a]/20"
          />
        )}

        {error && (
          <p className="text-red-500 text-sm mb-2">{error}</p>
        )}

        <div className="flex justify-end gap-3 mt-4">
          <button
            onClick={() => { setFile(null); setError(null); setUserClaim(""); onClose(); }}
            className="px-4 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={loading || !file}
            className="px-4 py-2 bg-[#1a2a3a] text-white rounded-lg text-sm hover:bg-[#243447] transition-colors disabled:opacity-50"
          >
            {loading ? "Validating..." : "Upload & Validate"}
          </button>
        </div>
      </div>
    </div>
  );
}
