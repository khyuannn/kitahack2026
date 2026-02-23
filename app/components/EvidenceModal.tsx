"use client";

import { useState } from "react";

interface EvidenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onValidated: (fileUri: string, fileName: string, fileType: string, evidenceId?: string) => void;
  caseId: string;
  role?: "plaintiff" | "defendant";
}

export default function EvidenceModal({
  isOpen,
  onClose,
  onValidated,
  caseId,
  role = "plaintiff",
}: EvidenceModalProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [userClaim, setUserClaim] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length === 0) return;

    const allowedTypes = ["image/jpeg", "image/png", "application/pdf", "text/plain", "text/markdown"];
    const allowedExtensions = [".jpg", ".jpeg", ".png", ".pdf", ".txt", ".md"];
    const validFiles: File[] = [];

    for (const selected of selectedFiles) {
      if (selected.size > 5 * 1024 * 1024) {
        setError("Each file must be ≤ 5MB.");
        continue;
      }
      const ext = selected.name.toLowerCase().slice(selected.name.lastIndexOf("."));
      if (!allowedTypes.includes(selected.type) && !allowedExtensions.includes(ext)) {
        setError("Only JPG, PNG, PDF, TXT, or MD files allowed.");
        continue;
      }
      validFiles.push(selected);
    }

    if (validFiles.length > 0) {
      setError(null);
      setFiles((prev) => {
        const existing = new Set(prev.map((f) => `${f.name}-${f.size}`));
        const fresh = validFiles.filter((f) => !existing.has(`${f.name}-${f.size}`));
        return [...prev, ...fresh];
      });
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (files.length === 0) return;

    setLoading(true);

    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("user_claim", userClaim || `Evidence: ${file.name}`);
        formData.append("uploaded_by", role);

        const res = await fetch(
          `/api/cases/${caseId}/upload-evidence?uploaded_by=${encodeURIComponent(role)}`,
          { method: "POST", body: formData }
        );

        const text = await res.text();
        let data: any;
        try {
          data = JSON.parse(text);
        } catch {
          if (!res.ok) throw new Error(text || `Upload failed (HTTP ${res.status})`);
          throw new Error("Unexpected response from server");
        }

        if (!res.ok) {
          throw new Error(data.detail || "Validation failed");
        }

        onValidated(data.file_uri, file.name, file.type, data.evidence_id);
      }

      setSuccess(true);
      // Show success for 1.5s then close
      setTimeout(() => {
        setFiles([]);
        setUserClaim("");
        setSuccess(false);
        onClose();
      }, 1500);

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
          accept=".jpg,.jpeg,.png,.pdf,.txt,.md"
          multiple
          onChange={handleFileChange}
          className="mb-3 w-full text-sm"
        />

        {files.length > 0 && (
          <div className="mb-3 space-y-2">
            {files.map((file, index) => (
              <div key={`${file.name}-${file.size}-${index}`} className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                <p className="text-xs text-gray-600 truncate pr-3">{file.name}</p>
                <button
                  onClick={() => removeFile(index)}
                  className="text-gray-400 hover:text-gray-600"
                  title="Remove file"
                >
                  <span className="material-icons" style={{ fontSize: 16 }}>close</span>
                </button>
              </div>
            ))}
          </div>
        )}

        {files.length > 0 && (
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

        {success && (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-2">
            <span className="material-icons text-green-600" style={{ fontSize: 18 }}>check_circle</span>
            <p className="text-green-700 text-sm font-medium">Evidence uploaded successfully!</p>
          </div>
        )}

        <div className="flex justify-end gap-3 mt-4">
          <button
            onClick={() => { setFiles([]); setError(null); setUserClaim(""); onClose(); }}
            className="px-4 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={loading || files.length === 0}
            className="px-4 py-2 bg-[#1a2a3a] text-white rounded-lg text-sm hover:bg-[#243447] transition-colors disabled:opacity-50"
          >
            {loading ? "Validating..." : "Upload & Validate"}
          </button>
        </div>
      </div>
    </div>
  );
}
