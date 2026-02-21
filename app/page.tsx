"use client";

import { useRouter } from "next/navigation";

export default function HomePage() {
  const router = useRouter();

  return (
    <div className="bg-white min-h-screen flex flex-col font-sans antialiased text-black selection:bg-gray-200">
      <div className="flex-grow flex flex-col px-6 pt-12 pb-8 max-w-md md:max-w-2xl lg:max-w-4xl mx-auto w-full">
        {/* Header */}
        <header className="flex items-center space-x-4 mb-20">
          <div className="bg-black text-white w-14 h-14 flex items-center justify-center rounded-lg shadow-sm">
            <span className="material-icons text-3xl">balance</span>
          </div>
          <h1 className="font-serif font-bold text-2xl tracking-tight">Lex-Machina</h1>
        </header>

        {/* Main */}
        <main className="flex-grow flex flex-col items-center justify-center text-center">
          <div className="font-serif font-black text-6xl leading-[1.1] tracking-tight mb-24">
            <div className="mb-2">WELCOME</div>
            <div className="mb-2">TO</div>
            <div className="mb-2">LEX-</div>
            <div>MACHINA</div>
          </div>
          <button
            onClick={() => router.push("/login")}
            className="bg-black hover:bg-gray-800 text-white w-full py-5 px-8 flex items-center justify-center space-x-3 transition-colors duration-200 group"
          >
            <span className="font-sans font-medium tracking-wide text-sm">START CASE</span>
            <span className="material-icons text-lg transform group-hover:translate-x-1 transition-transform">
              arrow_forward
            </span>
          </button>
        </main>

        {/* Footer */}
        <footer className="mt-auto pt-16">
          <p className="text-gray-500 text-center text-xs leading-relaxed max-w-[300px] mx-auto mb-8 font-light">
            Lex-Machina is a pre-court negotiation and settlement support tool — not a replacement for lawyers or judges.
          </p>
          <div className="border-t border-gray-200 w-full mb-8"></div>
          <div className="flex flex-col items-center space-y-6 text-xs text-gray-400 font-medium">
            <p>© 2026 Lex-Machina. All rights reserved.</p>
            <div className="flex space-x-8">
              <a className="hover:text-black transition-colors" href="#">Privacy Policy</a>
              <a className="hover:text-black transition-colors" href="#">Terms Of Service</a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
