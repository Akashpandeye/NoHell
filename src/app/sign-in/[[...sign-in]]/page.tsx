import { SignIn } from "@clerk/nextjs";

import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { clerkAppearance } from "@/lib/clerk-appearance";

export default function SignInPage() {
  return (
    <AuthPageShell
      title="Welcome back"
      subtitle="Sign in to keep your sessions, notes, and recall cards in sync."
      alternateHref="/sign-up"
      alternateLabel="Sign up"
    >
      <SignIn
        appearance={clerkAppearance}
        fallbackRedirectUrl="/"
        signUpUrl="/sign-up"
      />
    </AuthPageShell>
  );
}
