"use client";
import React from "react";

interface DeadlockScreenProps {
    caseId: string;
}

export default function DeadlockScreen({ caseId }: DeadlockScreenProps) {
    const [loading, setLoading] = React.useState(false);

    const handleExportCourtFiling = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/cases/${caseId}/export-pdf`, {
                method: "POST",
            });
            if (!res.ok) throw new Error("Export failed");
            const data = await res.json();
            // Open in new window for printing
            const printWindow = window.open("", "_blank");
            if (printWindow) {
                printWindow.document.write(`
                    <html><head><title>Court Filing</title>
                    <style>body{font-family:serif;max-width:700px;margin:40px auto;padding:20px;line-height:1.6}
                    h1{text-align:center}h2{border-bottom:1px solid #000;padding-bottom:4px}</style></head><body>
                    <h1>BORANG 198 - Small Claims Court</h1>
                    <h2>Plaintiff</h2><p>${data.plaintiff_details}</p>
                    <h2>Defendant</h2><p>${data.defendant_details}</p>
                    <h2>Statement of Claim</h2><p>${data.statement_of_claim}</p>
                    <h2>Amount Claimed</h2><p>${data.amount_claimed}</p>
                    <h2>Negotiation Summary</h2><p>${data.negotiation_summary}</p>
                    </body></html>
                `);
                printWindow.document.close();
            }
        } catch (err) {
            alert("Failed to export court filing.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col items-center justify-center h-screen">
            <h1 className="text-3xl font-bold text-red-600">
                Negotiation Failed
            </h1>

            <p className="text-gray-600 mt-4">
                The mediator has determined the negotiation cannot continue.
            </p>

            <button
                onClick={handleExportCourtFiling}
                disabled={loading}
                className="mt-6 px-6 py-3 bg-black text-white rounded"
            >
                {loading ? "Generating..." : "Export Court Filing (Form 198)"}
            </button>
        </div>
    );
}


