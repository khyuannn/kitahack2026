"use client";
import React from "react";

interface SettlementMeterProps {
  value?: number; // legacy — ignored if claimAmount provided
  claimAmount?: number;
  minAmount?: number | null; // defendant's initial offer (left anchor)
  plaintiffOffer?: number | null;
  defendantOffer?: number | null;
}

const SettlementMeter: React.FC<SettlementMeterProps> = ({
  value,
  claimAmount,
  minAmount,
  plaintiffOffer,
  defendantOffer,
}) => {
  // If using dual-sided mode (both claimAmount provided)
  if (claimAmount && claimAmount > 0) {
    const maxAmount = claimAmount;
    // Use defendant's initial offer as left anchor if available, else 0
    const scaleMin = minAmount != null && minAmount > 0 && minAmount < maxAmount ? minAmount : 0;
    const scaleRange = maxAmount - scaleMin;

    const toPercent = (val: number) =>
      Math.max(0, Math.min(100, ((val - scaleMin) / scaleRange) * 100));

    const defPct = defendantOffer != null ? toPercent(defendantOffer) : 0;
    const plPct = plaintiffOffer != null ? toPercent(plaintiffOffer) : 100;

    const hasOverlap = defPct >= plPct;

    return (
      <div className="w-full space-y-2.5">
        {/* Bar */}
        <div className="relative w-full h-4 bg-gradient-to-r from-blue-500 via-gray-100 to-red-500 rounded-full border border-gray-200 overflow-visible shadow-inner">
          {/* Overlap fill (settlement zone reached) */}
          {hasOverlap && (
            <div
              className="absolute top-0 h-full bg-gradient-to-r from-emerald-400/80 to-green-500/80 transition-all duration-500 ease-out rounded-full"
              style={{
                left: `${plPct}%`,
                width: `${defPct - plPct}%`,
              }}
            />
          )}

          {/* Defendant marker (starts left, moves right) */}
          {defendantOffer != null && (
            <div
              className="absolute top-1/2 -translate-y-1/2 transition-all duration-500 ease-out"
              style={{ left: `${defPct}%` }}
            >
              <div className="w-5 h-5 -ml-2.5 rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 border-2 border-white shadow-sm ring-2 ring-cyan-200" />
            </div>
          )}

          {/* Plaintiff marker (starts right, moves left) */}
          {plaintiffOffer != null && (
            <div
              className="absolute top-1/2 -translate-y-1/2 transition-all duration-500 ease-out"
              style={{ left: `${plPct}%` }}
            >
              <div className="w-5 h-5 -ml-2.5 rounded-full bg-gradient-to-br from-fuchsia-500 to-rose-600 border-2 border-white shadow-sm ring-2 ring-rose-200" />
            </div>
          )}
        </div>

        {/* Labels — fixed initial amounts as anchors */}
        <div className="flex justify-between items-center text-[10px] font-bold">
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-full bg-gradient-to-br from-cyan-400 to-blue-600" />
            <span className="text-blue-700">
              RM {scaleMin > 0 ? scaleMin.toLocaleString() : "0"}
            </span>
            <span className="text-gray-400 ml-0.5 uppercase tracking-wide">◀ Initial</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-gray-400 mr-0.5 uppercase tracking-wide">Claim ▶</span>
            <span className="text-gray-800">RM {maxAmount.toLocaleString()}</span>
            <div className="w-2.5 h-2.5 rounded-full bg-gradient-to-br from-fuchsia-500 to-rose-600" />
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
