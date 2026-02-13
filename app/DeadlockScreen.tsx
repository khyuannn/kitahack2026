"use client";
import React from "react";

interface DeadlockScreenProps {
    mediatorConfidence: number;
}

export default function DeadlockScreen({ mediatorConfidence }: DeadlockScreenProps) {
    const isDeadlock = mediatorConfidence < 0.4;
    const [loading, setLoading] = React.useState(false);

    const handleDownloadCourtPDF = async () => {
        setLoading(true);
        const res = await fetch("/api/generate-court-pdf");
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        window.open(url);
        setLoading(false);
    };

    if (!isDeadlock) {
        return null;
    }

    return (
        <div className="flex flex-col items-center justify-center h-screen">
            <h1 className="text-3xl font-bold text-red-600">
                Negotiation Failed
            </h1>

            <p className="text-gray-600 mt-4">
                The mediator has determined the negotiation cannot continue.
            </p>

            <button
                onClick={handleDownloadCourtPDF}
                className="mt-6 px-6 py-3 bg-black text-white rounded"
            >
                Download Court Filing PDF
            </button>
        </div>
    );
}


