import { SignUp } from "@clerk/nextjs";

import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { clerkAppearance } from "@/lib/clerk-appearance";

export default function SignUpPage() {
  return (
    <AuthPageShell
      title="Create your account"
      subtitle="Start skipping tutorial hell — one account for focused learning."
      alternateHref="/sign-in"
      alternateLabel="Sign in"
    >
      <SignUp
        appearance={clerkAppearance}
        fallbackRedirectUrl="/"
        signInUrl="/sign-in"
      />
    </AuthPageShell>
  );
}
