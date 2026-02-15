export const InviteButton = ({ caseId }: { caseId: string }) => {
  const generateLink = async () => {
    try {
      const link = `${window.location.origin}/negotiation/${caseId}`;

      await navigator.clipboard.writeText(link);
      alert("Invite link copied to clipboard!");

    } catch (error) {
      console.error("Failed to copy link:", error);
      alert("Could not copy link.");
    }
  };

  return (
    <button onClick={generateLink}>
      Invite
    </button>
  );
};

