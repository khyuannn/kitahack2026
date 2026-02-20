"use client";
import React from "react";

interface SettlementMeterProps {
  value: number; // value from 0 to 100
}

const SettlementMeter: React.FC<SettlementMeterProps> = ({ value }) => {
  const clampedValue = Math.max(0, Math.min(100, value));

  // Red (0%) → Yellow (50%) → Green (100%)
  const getColor = (v: number) => {
    if (v < 50) {
      // Red → Yellow
      const ratio = v / 50;
      const r = 239;
      const g = Math.round(68 + (158) * ratio); // 68 → 226
      const b = 68;
      return `rgb(${r}, ${g}, ${b})`;
    } else {
      // Yellow → Green
      const ratio = (v - 50) / 50;
      const r = Math.round(239 - (239 - 34) * ratio); // 239 → 34
      const g = Math.round(226 - (226 - 197) * ratio); // 226 → 197
      const b = Math.round(68 + (26) * ratio); // 68 → 94
      return `rgb(${r}, ${g}, ${b})`;
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
