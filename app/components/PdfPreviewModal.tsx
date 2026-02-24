"use client";

import React, { useRef } from "react";

interface PdfPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  htmlContent: string;
  title: string;
  fileName: string;
}

export default function PdfPreviewModal({
  isOpen,
  onClose,
  htmlContent,
  title,
  fileName,
}: PdfPreviewModalProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  if (!isOpen) return null;

  const handleDownloadPdf = async () => {
    try {
      // Dynamic import of html2pdf.js
      const html2pdf = (await import("html2pdf.js")).default;

      // Create a temporary container with the HTML content
      const container = document.createElement("div");
      container.innerHTML = htmlContent;
      document.body.appendChild(container);

      await html2pdf()
        .set({
          margin: [10, 10, 10, 10],
          filename: `${fileName}.pdf`,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        })
        .from(container)
        .save();

      document.body.removeChild(container);
    } catch (err) {
      console.error("PDF generation failed:", err);
      // Fallback: open in new window for printing
      const printWindow = window.open("", "_blank");
      if (printWindow) {
        printWindow.document.write(htmlContent);
        printWindow.document.close();
        printWindow.print();
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-[95vw] h-[90vh] max-w-4xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#1a2a3a] rounded-lg flex items-center justify-center">
              <span className="material-icons text-white text-lg">
                description
              </span>
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-900">{title}</h2>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">
                Document Preview
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadPdf}
              className="flex items-center gap-1.5 bg-[#1a2a3a] text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-[#243447] transition-colors"
            >
              <span className="material-icons" style={{ fontSize: 16 }}>
                download
              </span>
              Download PDF
            </button>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center hover:bg-gray-100 transition-colors"
            >
              <span className="material-icons text-lg text-gray-600">
                close
              </span>
            </button>
          </div>
        </div>

        {/* A4 Preview */}
        <div className="flex-1 overflow-auto bg-gray-100 p-4 md:p-8 flex justify-center">
          <div
            className="bg-white shadow-lg w-full max-w-[210mm] min-h-[297mm]"
            style={{
              padding: "20mm",
            }}
          >
            <iframe
              ref={iframeRef}
              srcDoc={htmlContent}
              className="w-full border-0"
              style={{ minHeight: "257mm", height: "100%" }}
              title="Document Preview"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
