"use client";

import { useCaseMessages } from "@/hooks/useCaseMessages";
import { Key, ReactElement, JSXElementConstructor, ReactNode, ReactPortal } from "react";
export default function NegotiationPage() {
  const caseId = "abc123";
  // Destructure for better control if your hook supports it
  const { messages, loading } = useCaseMessages(caseId);


  // Error Prevention: Handle the "Loading" state
  if (loading) {
    return <div style={{ padding: 20 }}>Loading messages...</div>;
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>Case ID: {caseId}</h2>

      <div
        style={{
          border: "1px solid #ccc",
          padding: 20,
          height: 400,
          overflowY: "scroll",
        }}
      >
        {/* Use optional chaining as a secondary safety measure */}
        {messages?.map((msg: { id: Key | null | undefined; role: string | number | bigint | boolean | ReactElement<unknown, string | JSXElementConstructor<any>> | Iterable<ReactNode> | Promise<string | number | bigint | boolean | ReactPortal | ReactElement<unknown, string | JSXElementConstructor<any>> | Iterable<ReactNode> | null | undefined> | null | undefined; content: string | number | bigint | boolean | ReactElement<unknown, string | JSXElementConstructor<any>> | Iterable<ReactNode> | ReactPortal | Promise<string | number | bigint | boolean | ReactPortal | ReactElement<unknown, string | JSXElementConstructor<any>> | Iterable<ReactNode> | null | undefined> | null | undefined; }) => (
          <div
            key={msg.id}
            style={{
              textAlign: msg.role === "plaintiff" ? "left" : "right",
              marginBottom: 10,
            }}
          >
            <strong>{msg.role}</strong>: {msg.content}
          </div>
        ))}
      </div>
    </div>
  );
}