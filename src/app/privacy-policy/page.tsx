import Link from "next/link";

export default function PrivacyPolicyPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-nh-bg px-4 py-12 text-nh-text sm:px-6 lg:px-8">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_55%_45%_at_50%_58%,var(--nh-teal-glow),transparent_72%)]"
      />

      <div className="relative z-10 mx-auto w-full max-w-3xl rounded-3xl border border-nh-border/70 bg-nh-surface/80 p-6 backdrop-blur sm:p-8">
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
          Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-nh-muted">Last updated: April 15, 2026</p>

        <div className="mt-8 space-y-6 text-sm leading-relaxed text-nh-text/95">
          <section>
            <h2 className="font-display text-xl font-bold text-nh-text">
              What we collect
            </h2>
            <p className="mt-2 text-nh-muted">
              We collect account details (such as your email), learning session
              inputs (like tutorial links and goals), and usage data needed to
              run and improve NoHell.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-bold text-nh-text">
              How we use it
            </h2>
            <p className="mt-2 text-nh-muted">
              We use this information to provide core product features, maintain
              account security, process payments for paid plans, and improve the
              learning experience.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-bold text-nh-text">
              Sharing and third parties
            </h2>
            <p className="mt-2 text-nh-muted">
              We share data only with service providers required to operate the
              product (for example authentication, hosting, and payment
              processing). We do not sell personal information.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-bold text-nh-text">
              Retention and your choices
            </h2>
            <p className="mt-2 text-nh-muted">
              We retain data for as long as needed to provide the service and
              meet legal obligations. You can request account deletion or ask
              privacy questions by contacting us.
            </p>
          </section>
        </div>

        <div className="mt-10 border-t border-nh-border/60 pt-5 text-sm text-nh-muted">
          Contact:{" "}
          <a className="text-nh-teal underline decoration-nh-teal/50" href="mailto:privacy@nohell.app">
            privacy@nohell.app
          </a>
        </div>

        <Link
          href="/"
          className="mt-8 inline-flex rounded-xl border border-nh-border bg-nh-surface-2 px-4 py-2 text-sm text-nh-muted transition-colors hover:border-nh-teal/40 hover:text-nh-text"
        >
          Back to home
        </Link>
      </div>
    </main>
  );
}
