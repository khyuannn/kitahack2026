"use client";
import React, { useState } from "react";

interface StrategyConsoleProps {
  onSend: (message: string, chip?: string) => void;
  disabled?: boolean;
  aiTyping?: boolean;
  auditorWarning?: boolean;
  onRetry?: () => void;
  onProceed?: () => void;
  chips?: string[];
}

export default function StrategyConsole({
  onSend,
  disabled = false,
  aiTyping = false,
  auditorWarning = false,
  onRetry,
  onProceed,
  chips = [],
}: StrategyConsoleProps) {
  const [input, setInput] = useState("");

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setInput("");
  };

  // Handle chip click
  const handleChipClick = (chip: string) => {
    onSend(chip, chip);
    setInput(""); // optional: clear input
  };

  if (auditorWarning) {
    return (
      <div className="fixed bottom-0 left-0 w-full bg-yellow-200 border-t p-4 flex justify-between items-center gap-3">
        <span className="text-yellow-900 font-bold">
          ⚠ Auditor Warning: Review carefully!
        </span>
        <div className="flex gap-2">
          <button
            onClick={onRetry}
            className="px-4 py-2 bg-gray-700 text-white rounded"
          >
            Retry
          </button>
          <button
            onClick={onProceed}
            className="px-4 py-2 bg-green-600 text-white rounded"
          >
            Proceed
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-0 left-0 w-full bg-white border-t p-4 flex flex-col gap-2">
      {aiTyping ? (
        <p className="text-gray-500 italic">Opponent is typing...</p>
      ) : (
        <>
          {/* Chips */}
          {chips.length > 0 && (
            <div className="flex gap-2 mb-2">
              {chips.map((chip) => (
                <button
                  key={chip}
                  onClick={() => handleChipClick(chip)}
                  disabled={disabled}
                  className={`px-3 py-1 rounded text-white ${
                    disabled ? "bg-gray-400 cursor-not-allowed" : "bg-black"
                  }`}
                >
                  {chip}
                </button>
              ))}
            </div>
          )}

          {/* Input & Send */}
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Enter your strategy..."
              className="flex-1 border rounded px-3 py-2"
              disabled={disabled}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSend();
              }}
            />
            <button
              onClick={handleSend}
              disabled={disabled}
              className={`px-4 py-2 rounded text-white ${
                disabled ? "bg-gray-400 cursor-not-allowed" : "bg-black"
              }`}
            >
              Send
            </button>
          </div>
        </>
      )}
    </div>
  );
}
