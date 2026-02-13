"use client";
import React from "react";

interface SettlementMeterProps {
  value: number; // value from 0 to 100
}

const SettlementMeter: React.FC<SettlementMeterProps> = ({ value }) => {
    const clampedValue = Math.max(0, Math.min(100, value));
    return (
    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-6">
      <div
        className="bg-green-500 h-6 rounded-full"
        style={{ width: `${clampedValue}%` }}
      />
    </div>
  );
};

export default SettlementMeter;
