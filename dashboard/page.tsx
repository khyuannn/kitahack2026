// app/page.tsx
"use client"; // if you have client-side interactions (like the dark mode toggle)

export default function HomePage() {
  return (
    <div className="bg-background-light dark:bg-background-dark text-primary dark:text-white transition-colors duration-300 min-h-screen">
      <div className="h-12 w-full"></div>
      <div className="flex flex-col min-h-[calc(100vh-3rem)] px-8 max-w-md mx-auto">

        //header
        <header className="flex items-center gap-4 py-6">
          <div className="bg-primary dark:bg-white p-2.5 rounded-lg flex items-center justify-center">
            <span className="material-icons text-white dark:text-black text-2xl">balance</span>
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Lex-Machina</h1>
        </header>

        //Main
        <main className="flex-grow flex flex-col items-center justify-center text-center space-y-16 py-12">
          <h2 className="font-display text-[2.75rem] leading-[1.1] font-black uppercase tracking-tight text-balance">
            Welcome To<br />Lex-Machina
          </h2>
          <button className="bg-primary dark:bg-white text-white dark:text-black w-full py-6 flex items-center justify-center gap-3 transition-transform active:scale-[0.98] group">
            <span className="font-sans font-medium tracking-widest text-sm uppercase pl-4">
              Start Case
            </span>
            <span className="material-icons text-xl group-hover:translate-x-1 transition-transform">
              arrow_forward
            </span>
          </button>
        </main>

        //footer
        <footer className="mt-auto pt-8 pb-12 space-y-10">
          <p className="text-[13px] leading-relaxed text-gray-500 dark:text-gray-400 font-sans px-2">
            Lex-Machina is a pre-court negotiation and settlement support tool — not a replacement for lawyers or judges.
          </p>
          <div className="space-y-6">
            <div className="h-[1px] w-full bg-gray-200 dark:bg-gray-800"></div>
            <div className="flex flex-col items-center gap-6 text-[12px] font-medium text-gray-400 uppercase tracking-wider">
              <p>© 2026 Lex-Machina. All rights reserved.</p>
              <div className="flex gap-8">
                <a className="hover:text-primary dark:hover:text-white transition-colors" href="#">
                  Privacy Policy
                </a>
                <a className="hover:text-primary dark:hover:text-white transition-colors" href="#">
                  Terms of Service
                </a>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
