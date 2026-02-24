"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function UploadEvidencePage() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);

  const handleFiles = (newFiles: FileList | null) => {
    if (!newFiles) return;
    const allowed = Array.from(newFiles).filter((f) =>
      /\.(pdf|txt|md|png|jpg|jpeg|webp)$/i.test(f.name)
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

  const handleContinue = () => {
    // Store file names in localStorage (actual files stay in state / will be uploaded during verification)
    const stored = localStorage.getItem("caseData");
    const existing = stored ? JSON.parse(stored) : {};
    localStorage.setItem(
      "caseData",
      JSON.stringify({
        ...existing,
        evidenceFileNames: files.map((f) => f.name),
      })
    );

    // Store files in sessionStorage isn't practical for large files,
    // so we'll pass them via a global for the next page to pick up
    if (typeof window !== "undefined") {
      (window as any).__evidenceFiles = files;
    }

    router.push("/case/new/verification");
  };

  return (
    <div className="bg-off-white min-h-screen font-sans antialiased text-gray-900 pb-44">
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
              Step 3
            </span>
            <span className="text-xs font-semibold text-gray-400 tracking-wide">
              Of 4
            </span>
          </div>

          {/* Back link */}
          <button
            onClick={() => router.push("/case/new/details")}
            className="inline-flex items-center text-text-secondary-light text-xs font-semibold mb-6 hover:text-primary transition-colors uppercase tracking-wide"
          >
            <span className="material-icons text-sm mr-1">arrow_back</span>
            Back to Details
          </button>

          <div className="mb-8">
            <h2 className="font-display text-4xl font-bold text-gray-900 mb-2 leading-tight">
              Upload Evidence
            </h2>
            <p className="text-text-secondary-light text-sm font-normal">
              Attach supporting documents for your case
            </p>
          </div>

          {/* Upload Zone */}
          <div
            className={`border border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer ${
              dragActive
                ? "border-blue-500 bg-blue-50"
                : "border-gray-200 hover:border-gray-300 bg-gray-50/80"
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
            onClick={() => document.getElementById("file-input")?.click()}
          >
            <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span className="material-icons text-3xl text-gray-400">cloud_upload</span>
            </div>
            <p className="text-sm font-semibold text-gray-700 mb-1">
              Drag & drop files here
            </p>
            <p className="text-xs text-gray-400 mb-4">or click to browse</p>
            <span className="inline-flex items-center gap-1 bg-black text-white text-xs font-semibold px-4 py-2 rounded-lg">
              <span className="material-icons text-sm">add</span>
              Choose Files
            </span>
            <input
              id="file-input"
              type="file"
              className="hidden"
              multiple
              accept=".pdf,.txt,.md,.png,.jpg,.jpeg,.webp"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>

          {/* Accepted formats note */}
          <div className="mt-4 flex items-start gap-2">
            <span className="material-icons text-xs text-gray-400 mt-0.5">info</span>
            <p className="text-[11px] text-gray-400">
              Accepted: PDF, TXT, MD, PNG, JPG, JPEG, WEBP · Max 5 MB per file
            </p>
          </div>

          {/* File List */}
          {files.length > 0 && (
            <div className="mt-6 space-y-3">
              <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wide max-w-3xl">
                Uploaded Files ({files.length})
              </h3>
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
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(index);
                    }}
                    className="text-gray-400 hover:text-red-500 transition-colors shrink-0"
                  >
                    <span className="material-icons text-xl">close</span>
                  </button>
                </div>
              ))}
            </div>
          )}

        </main>

        <footer className="fixed bottom-0 left-0 right-0 z-20 border-t border-gray-100 bg-white/95 backdrop-blur-sm">
          <div className="max-w-5xl mx-auto px-6 py-4">
            <button
              onClick={handleContinue}
              disabled={files.length === 0}
              className={`w-full font-semibold py-3.5 px-6 rounded-lg flex items-center justify-center gap-2 shadow-sm transition-all duration-200 group ${
                files.length === 0
                  ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                  : "bg-[#1a2a3a] hover:bg-[#243447] text-white"
              }`}
            >
              <span className="text-base">Verify Evidence</span>
              <span className="material-icons text-lg group-hover:translate-x-1 transition-transform">
                arrow_forward
              </span>
            </button>
            <button
              onClick={() => {
                localStorage.setItem(
                  "caseData",
                  JSON.stringify({
                    ...JSON.parse(localStorage.getItem("caseData") || "{}"),
                    evidenceFileNames: [],
                  })
                );
                router.push("/case/new/verification");
              }}
              className="w-full text-center text-xs text-gray-400 font-semibold mt-3 hover:text-gray-600 transition-colors uppercase tracking-wide"
            >
              Skip for now
            </button>
            <div className="mt-2 flex justify-center gap-8 mb-2">
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
