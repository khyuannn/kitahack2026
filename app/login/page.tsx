"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";

export default function LoginPage() {
  const router = useRouter();
  const {
    signInWithGoogle,
    signInWithEmailPassword,
    signUpWithEmailPassword,
  } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSignUpMode, setIsSignUpMode] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Please enter both email and password.");
      return;
    }

    setSigningIn(true);
    setError(null);

    try {
      if (isSignUpMode) {
        await signUpWithEmailPassword(email, password);
      } else {
        await signInWithEmailPassword(email, password);
      }
      router.push("/case/new");
    } catch (err: any) {
      console.error("Email/password auth error:", err);
      setError(err.message || "Authentication failed. Please try again.");
      setSigningIn(false);
    }
  };

  const handleGoogleLogin = async () => {
    setSigningIn(true);
    setError(null);
    try {
      await signInWithGoogle();
      router.push("/case/new");
    } catch (err: any) {
      console.error("Google login error:", err);
      setError(err.message || "Google sign-in failed. Please try again.");
      setSigningIn(false);
    }
  };

  return (
    <div className="bg-off-white min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-[440px] md:max-w-lg flex flex-col items-center">
        <div className="w-full mb-6">
          <button
            onClick={() => router.push("/")}
            className="inline-flex items-center text-text-secondary-light text-xs font-semibold hover:text-primary transition-colors uppercase tracking-wide"
          >
            <span className="material-icons text-sm mr-1">arrow_back</span>
            Back to Home
          </button>
        </div>

        {/* Logo & Branding */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-primary text-white rounded-lg mb-4">
            <span className="material-symbols-outlined text-2xl">balance</span>
          </div>
          <h1 className="text-3xl font-serif tracking-tight text-primary mb-2">LexSuluh</h1>
          <p className="text-gray-500 text-sm font-medium">Malaysian Settlement Platform</p>
        </div>

        {/* Login Card */}
        <div className="login-card w-full rounded-2xl p-8 md:p-10">
          <h2 className="text-xl font-semibold mb-8 text-center">
            {isSignUpMode ? "Create your account" : "Login to your account"}
          </h2>

          {/* Google Login */}
          <button
            onClick={handleGoogleLogin}
            disabled={signingIn}
            className="w-full flex items-center justify-center gap-3 bg-white border border-gray-200 h-12 rounded-lg hover:bg-gray-50 transition-all duration-200 mb-6 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {signingIn ? (
              <span className="text-sm font-medium text-gray-500">Signing in...</span>
            ) : (
              <>
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                <span className="text-sm font-medium text-gray-700">Continue with Google</span>
              </>
            )}
          </button>

          {/* Error message */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-xs text-red-600">{error}</p>
            </div>
          )}

          {/* Divider */}
          <div className="relative flex items-center gap-4 mb-6">
            <div className="h-[1px] flex-1 bg-gray-100"></div>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">or email</span>
            <div className="h-[1px] flex-1 bg-gray-100"></div>
          </div>

          {/* Email Form */}
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5 ml-0.5">
                Professional Email
              </label>
              <input
                className="w-full bg-off-white border border-transparent rounded-lg h-12 px-4 text-sm transition-all outline-none focus:ring-1 focus:ring-brand-accent focus:border-brand-accent"
                placeholder="name@firm.com.my"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider ml-0.5">
                  Password
                </label>
                <a className="text-brand-accent text-xs font-semibold hover:text-blue-800 transition-colors" href="#">
                  Forgot?
                </a>
              </div>
              <div className="relative flex items-center">
                <input
                  className="w-full bg-off-white border border-transparent rounded-lg h-12 px-4 text-sm transition-all outline-none pr-12 focus:ring-1 focus:ring-brand-accent focus:border-brand-accent"
                  placeholder="••••••••"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  className="absolute right-4 text-gray-400 hover:text-gray-600"
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  <span className="material-symbols-outlined text-xl">
                    {showPassword ? "visibility_off" : "visibility"}
                  </span>
                </button>
              </div>
            </div>
            <button
              className="w-full bg-primary hover:bg-black text-white font-semibold h-12 rounded-lg transition-all active:scale-[0.98] mt-2 shadow-sm"
              type="submit"
              disabled={signingIn}
            >
              {signingIn ? "Please wait..." : isSignUpMode ? "Sign Up" : "Sign In"}
            </button>
          </form>
        </div>

        {/* Bottom Links */}
        <div className="mt-8 text-center">
          <p className="text-sm text-gray-500">
            {isSignUpMode ? "Already have an account?" : "New to the platform?"}
            <button
              className="text-brand-accent font-semibold hover:underline ml-1"
              type="button"
              onClick={() => {
                setError(null);
                setIsSignUpMode((prev) => !prev);
              }}
            >
              {isSignUpMode ? "Sign in" : "Create an account"}
            </button>
          </p>
          <div className="mt-12 flex flex-col items-center gap-3">
            <div className="flex items-center gap-2 opacity-60">
              <span className="material-symbols-outlined text-sm">verified_user</span>
              <span className="text-[10px] uppercase tracking-[0.2em] font-bold">
                Secure Malaysian Legal Infrastructure
              </span>
            </div>
            <div className="flex gap-4 text-[10px] text-gray-400 font-medium">
              <a className="hover:text-gray-600 transition-colors" href="#">Privacy Policy</a>
              <a className="hover:text-gray-600 transition-colors" href="#">Terms of Service</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
