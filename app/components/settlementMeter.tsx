"use client";
import React from "react";

interface SettlementMeterProps {
  value?: number; // legacy — ignored if claimAmount provided
  claimAmount?: number;
  plaintiffOffer?: number | null;
  defendantOffer?: number | null;
}

const SettlementMeter: React.FC<SettlementMeterProps> = ({
  value,
  claimAmount,
  plaintiffOffer,
  defendantOffer,
}) => {
  // If using dual-sided mode (both claimAmount provided)
  if (claimAmount && claimAmount > 0) {
    const maxAmount = claimAmount;
    const defPct = defendantOffer != null ? Math.max(0, Math.min(100, (defendantOffer / maxAmount) * 100)) : 0;
    const plPct = plaintiffOffer != null ? Math.max(0, Math.min(100, (plaintiffOffer / maxAmount) * 100)) : 100;

    // Gap analysis
    const gap = plPct - defPct;
    const gapColor =
      gap <= 0
        ? "bg-green-400/40"
        : gap < 30
        ? "bg-yellow-400/40"
        : "bg-red-400/40";

    return (
      <div className="w-full space-y-2">
        {/* Bar */}
        <div className="relative w-full h-3 bg-gray-200 rounded-full overflow-visible">
          {/* Gap fill between markers */}
          {defPct < plPct && (
            <div
              className={`absolute top-0 h-full ${gapColor} transition-all duration-500 ease-out`}
              style={{
                left: `${defPct}%`,
                width: `${plPct - defPct}%`,
              }}
            />
          )}
          {/* Overlap fill (settlement zone) */}
          {defPct >= plPct && (
            <div
              className="absolute top-0 h-full bg-green-400/50 transition-all duration-500 ease-out"
              style={{
                left: `${plPct}%`,
                width: `${defPct - plPct}%`,
              }}
            />
          )}

          {/* Defendant marker (left, moves right) */}
          {defendantOffer != null && (
            <div
              className="absolute top-1/2 -translate-y-1/2 transition-all duration-500 ease-out"
              style={{ left: `${defPct}%` }}
            >
              <div className="w-4 h-4 -ml-2 rounded-full bg-blue-500 border-2 border-white shadow-md" />
            </div>
          )}

          {/* Plaintiff marker (right, moves left) */}
          {plaintiffOffer != null && (
            <div
              className="absolute top-1/2 -translate-y-1/2 transition-all duration-500 ease-out"
              style={{ left: `${plPct}%` }}
            >
              <div className="w-4 h-4 -ml-2 rounded-full bg-gray-800 border-2 border-white shadow-md" />
            </div>
          )}
        </div>

        {/* Labels */}
        <div className="flex justify-between items-center text-[9px] font-bold">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            <span className="text-blue-600">
              {defendantOffer != null ? `RM ${defendantOffer.toLocaleString()}` : "—"}
            </span>
            <span className="text-gray-400 ml-0.5">Def.</span>
          </div>
          <span className="text-gray-400">
            RM 0 — RM {maxAmount.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <span className="text-gray-400 mr-0.5">Plt.</span>
            <span className="text-gray-700">
              {plaintiffOffer != null ? `RM ${plaintiffOffer.toLocaleString()}` : "—"}
            </span>
            <div className="w-2 h-2 rounded-full bg-gray-800" />
          </div>
        </div>
      </div>
    );
  }

  // Legacy single-bar mode fallback
  const clampedValue = Math.max(0, Math.min(100, value || 0));
  const getColor = (v: number) => {
    if (v < 50) {
      const ratio = v / 50;
      return `rgb(239, ${Math.round(68 + 158 * ratio)}, 68)`;
    } else {
      const ratio = (v - 50) / 50;
      return `rgb(${Math.round(239 - 205 * ratio)}, ${Math.round(226 - 29 * ratio)}, ${Math.round(68 + 26 * ratio)})`;
    }
  };

  return (
    <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
      <div
        className="h-2.5 rounded-full transition-all duration-500 ease-out"
        style={{
          width: `${clampedValue}%`,
          backgroundColor: getColor(clampedValue),
        }}
      />
    </div>
  );
};

export default SettlementMeter;
