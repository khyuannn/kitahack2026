"use client";
import React, { useRef, useEffect } from "react";
import StrategyConsole from "./StrategyConsole";
import { CaseMessage } from "@/hooks/useCaseMessages";

type ConsoleMode =
  | "USER_TURN"
  | "AI_TURN"
  | "AUDITOR_WARNING";

interface ChatScrollBoxProps {
  messages: CaseMessage[];
  handleSend: (message: string) => void;
  mode: ConsoleMode;
  onRetry?: () => void;
  onProceed?: () => void;
}

export default function ChatScrollBox({
  messages,
  handleSend,
  mode,
  onRetry,
  onProceed,
}: ChatScrollBoxProps) {
  const chatBoxRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    if (!chatBoxRef.current) return;

    chatBoxRef.current.scrollTo({
      top: chatBoxRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  return (
    <div className="flex flex-col h-screen">

      {/* Scrollable Chat Area */}
      <div
        ref={chatBoxRef}
        className="flex-1 overflow-y-auto border p-5"
      >
        {messages?.map((msg) => (
          <div
            key={msg.id}
            className={`mb-3 ${
              msg.role === "plaintiff"
                ? "text-left"
                : "text-right"
            }`}
          >
            <div className="inline-block bg-gray-100 px-3 py-2 rounded-lg">
              <strong>{msg.role}</strong>: {msg.content}
            </div>
          </div>
        ))}
      </div>

      {/* Fixed Commander Console */}
      <StrategyConsole
        onSend={handleSend}
        onRetry={onRetry}
        onProceed={onProceed}
      />
    </div>
  );
}
