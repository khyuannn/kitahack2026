// frontend/firebase/config.ts
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Firebase config - must match the backend's Firebase project (lexmachine-49c1e)
const firebaseConfig = {
    apiKey: "AIzaSyCR9t16_l5VHCO6q-6jB2-kDPFxsDFLVEY",
    authDomain: "lexmachine-49c1e.firebaseapp.com",
    projectId: "lexmachine-49c1e",
    storageBucket: "lexmachine-49c1e.firebasestorage.app",
    messagingSenderId: "725192250329",
    appId: "1:725192250329:web:2a528d6143101860e27fc8",
    measurementId: "G-NQ9HB1LZ74" // optional
};

// Initialize Firebase only if not already initialized
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Firebase services you’ll use
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db };