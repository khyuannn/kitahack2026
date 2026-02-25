"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const disputeTypes = [
  {
    id: "tenancy_deposit",
    icon: "apartment",
    iconBg: "bg-blue-50",
    iconColor: "text-blue-600",
    title: "Tenancy and Rental Dispute",
    description:
      "Security deposit refunds, unpaid rent, or property damage disputes for residential properties.",
    eligible: true,
    enabled: true,
  },
  {
    id: "consumer_ecommerce",
    icon: "shopping_bag",
    iconBg: "bg-purple-50",
    iconColor: "text-purple-600",
    title: "Consumer and E-Commerce Disputes",
    description:
      "Defective goods, items not matching their description, or fake products bought online (e.g., Carousell/Shopee).",
    eligible: true,
    enabled: true,
  },
  {
    id: "freelance_unpaid",
    icon: "work_outline",
    iconBg: "bg-indigo-50",
    iconColor: "text-indigo-600",
    title: "Freelance and Unpaid Services",
    description:
      "Unpaid invoices, breach of agreement, or failure to deliver services as promised between individuals or freelancers.",
    eligible: true,
    enabled: true,
  },
  {
    id: "other",
    icon: "more_horiz",
    iconBg: "bg-gray-50",
    iconColor: "text-gray-400",
    title: "Other Disputes",
    description:
      "Additional dispute categories will be available in the full release.",
    eligible: false,
    enabled: false,
  },
];

export default function SelectDisputeTypePage() {
  const router = useRouter();
  const [selected, setSelected] = useState("tenancy_deposit");

  const handleContinue = () => {
    localStorage.setItem("caseData", JSON.stringify({ disputeType: selected }));
    router.push("/case/new/details");
  };

  return (
    <div className="bg-off-white min-h-screen font-sans antialiased text-gray-900 pb-40">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
          <div className="w-10 h-10 bg-black rounded-lg flex items-center justify-center shrink-0">
            <span className="material-icons-round text-white text-2xl">balance</span>
          </div>
          <h1 className="font-serif font-bold text-2xl tracking-tight text-black">Lex-Machina</h1>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <button
          onClick={() => router.push("/login")}
          className="inline-flex items-center text-text-secondary-light text-xs font-semibold mb-6 hover:text-primary transition-colors uppercase tracking-wide"
        >
          <span className="material-icons text-sm mr-1">arrow_back</span>
          Back to Login
        </button>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-4">
          <span className="bg-black text-white text-xs font-bold px-2 py-1 rounded">Step 1</span>
          <span className="text-xs font-semibold text-gray-400 tracking-wide">OF 4</span>
        </div>

        <h2 className="font-serif text-4xl font-bold mb-3 text-gray-900">Select Dispute Type</h2>
        <p className="text-gray-500 text-sm leading-relaxed mb-8">
          Choose the category that best describes your legal claim.
        </p>

        {/* Dispute Type Cards */}
        <div className="space-y-4 md:grid md:grid-cols-2 md:gap-4 md:space-y-0">
          {disputeTypes.map((type) => (
            <div
              key={type.id}
              onClick={() => type.enabled && setSelected(type.id)}
              className={`bg-white rounded-2xl p-6 shadow-sm relative overflow-hidden cursor-pointer transition-all ${
                !type.enabled
                  ? "bg-transparent border border-dashed border-gray-200 opacity-70 cursor-not-allowed"
                  : selected === type.id
                  ? "border border-blue-500"
                  : "border border-gray-100 hover:border-gray-200"
              }`}
            >
              <div className="flex justify-between items-start mb-4">
                <div
                  className={`w-12 h-12 ${type.iconBg} rounded-xl flex items-center justify-center ${type.iconColor}`}
                >
                  <span className="material-icons-round text-2xl">{type.icon}</span>
                </div>
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider ${
                    type.eligible
                      ? "bg-green-100 text-green-700"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  <span className="material-icons-round text-xs">
                    {type.eligible ? "check_circle" : "schedule"}
                  </span>
                  {type.eligible ? "Autonomous Eligible" : "Coming Soon - Post Beta"}
                </span>
              </div>
              <h3 className={`text-lg font-bold mb-2 ${type.enabled ? "text-gray-900" : "text-gray-400"}`}>
                {type.title}
              </h3>
              <p className={`text-sm leading-relaxed ${type.enabled ? "text-gray-500" : "text-gray-400"}`}>
                {type.description}
              </p>
            </div>
          ))}
        </div>

        {/* Info Box */}
        <div className="mt-8 bg-blue-50 rounded-xl p-5 flex gap-3 items-start">
          <div className="bg-black text-white rounded-full w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">
            <span className="text-xs font-bold font-serif">i</span>
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase text-black mb-2 tracking-wide">
              Malaysian Jurisdiction Note
            </h4>
            <p className="text-xs text-gray-600 leading-relaxed">
              Cases under RM 5,000 are processed via the Small Claims Court framework. Lex-Machina
              uses these guidelines to optimize outcomes.
            </p>
          </div>
        </div>

      </main>

      <footer className="fixed bottom-0 left-0 right-0 z-20 border-t border-gray-100 bg-white/95 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <button
            onClick={handleContinue}
            className="w-full bg-[#1E293B] hover:bg-slate-800 text-white font-semibold py-3.5 px-6 rounded-lg flex items-center justify-center gap-2 shadow-sm transition-colors group"
          >
            <span className="text-base">Initialize Case</span>
            <span className="material-icons-round group-hover:translate-x-1 transition-transform">
              arrow_forward
            </span>
          </button>
          <div className="mt-3 text-center space-y-2">
            <div className="flex justify-center gap-6 text-[11px] font-medium text-gray-400">
              <a className="hover:text-gray-600" href="#">Privacy Policy</a>
              <a className="hover:text-gray-600" href="#">Terms of Service</a>
            </div>
            <p className="text-[10px] text-gray-400">© 2026 Lex-Machina</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
