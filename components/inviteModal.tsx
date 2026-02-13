import { db } from "@/firebase/config";
import { collection, addDoc, serverTimestamp, Timestamp } from "firebase/firestore";
import { doc, setDoc } from "firebase/firestore";

export const InviteButton = ({ caseId }: { caseId: string}) => {
const generateLink = async (caseId: string) => {
  try {
    const token = crypto.randomUUID();
    
    // Calculate expiration (24 hours from now)
    const expireDate = new Date();
    expireDate.setHours(expireDate.getHours() + 24);

    await setDoc(doc(db, "invites", token), {
      caseId,
      role: "defendant",
      createdAt: serverTimestamp(), // Good for auditing
      expiresAt: Timestamp.fromDate(expireDate), 
      used: false
    });

    const link = `${window.location.origin}/invite/${token}`;

    await navigator.clipboard.writeText(link);
    alert("Invite link copied to clipboard!");
    
  } catch (error) {
    console.error("Failed to generate link:", error);
    alert("Check your internet connection or permissions.");
  }
};

return (
    <button onClick={() => generateLink(caseId)}>
      Invite
    </button>
  );
};
