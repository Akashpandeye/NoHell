import { dark } from "@clerk/themes";

/** Shared Clerk UI — tuned for NoHell dark shell; card is transparent (frame is outside). */
export const clerkAppearance = {
  baseTheme: dark,
  variables: {
    colorPrimary: "#14b8a6",
    colorDanger: "#f87171",
    colorSuccess: "#34d399",
    colorWarning: "#fbbf24",
    colorBackground: "#0c1413",
    colorInputBackground: "#040807",
    /** Default + muted copy (labels like “Email address” / “Password” use muted foreground in Clerk v5). */
    colorForeground: "#ffffff",
    colorMutedForeground: "#ffffff",
    colorInputText: "#ffffff",
    colorInputForeground: "#ffffff",
    colorText: "#ffffff",
    colorTextSecondary: "#ffffff",
    colorNeutral: "#1f2e2c",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full mx-auto",
    card: "bg-transparent shadow-none border-0 p-0 gap-6 w-full",
    header: "gap-1",
    headerTitle: "sr-only",
    headerSubtitle: "sr-only",
    main: "gap-5",
    socialButtonsRoot: "gap-2.5",
    socialButtonsBlockButton:
      "!text-white [color:#ffffff!important] rounded-xl border-2 border-white/20 bg-nh-surface-2 hover:bg-nh-surface hover:border-nh-teal/40 transition-colors duration-200 [&_span]:!text-white",
    socialButtonsBlockButtonText: "!text-white font-medium text-sm [color:#ffffff!important]",
    /** OAuth label text often picks up `colorPrimary`; pin white for Google. */
    socialButtonsBlockButton__google:
      "!text-white [color:#ffffff!important] rounded-xl border-2 border-white/20 bg-nh-surface-2 hover:bg-nh-surface hover:border-nh-teal/40 transition-colors duration-200 [&_span]:!text-white",
    socialButtonsBlockButtonText__google: "!text-white font-medium text-sm [color:#ffffff!important]",
    dividerRow: "my-1",
    dividerLine: "bg-nh-border",
    dividerText: "text-white text-xs uppercase tracking-wider",
    formFieldRow: "gap-2 [&_label]:!text-white",
    formFieldLabel: "!text-white text-sm font-medium",
    formFieldLabelRow: "text-white [&_span]:!text-white",
    formFieldInput:
      "bg-nh-bg border-nh-border text-white placeholder:text-white/55 rounded-xl border focus:border-nh-teal focus:ring-2 focus:ring-nh-teal/25 transition-shadow duration-200",
    formFieldInputShowPasswordButton: "text-white hover:text-white/90",
    formButtonPrimary:
      "bg-nh-cta hover:bg-nh-cta-hover text-neutral-950 font-bold rounded-xl shadow-none transition-colors duration-200",
    formButtonReset: "text-white hover:text-white/90",
    footer: "mt-8 border-t border-nh-border/60 pt-6",
    footerAction: "gap-1",
    footerActionText: "text-white text-sm",
    footerActionLink:
      "text-white font-semibold hover:text-white/90 underline-offset-2 hover:underline transition-colors",
    identityPreviewText: "text-white",
    identityPreviewEditButton: "text-white hover:text-white/90",
    formFieldErrorText: "text-orange-300 text-sm",
    formFieldSuccessText: "text-emerald-400 text-sm",
    alertText: "text-sm text-white",
    otpCodeFieldInput:
      "bg-nh-bg border-nh-border text-white rounded-xl border focus:border-nh-teal",
    formResendCodeLink: "text-white hover:text-white/90",
    spinner: "text-nh-teal",

    userButtonPopoverCard: "border border-nh-border bg-nh-surface shadow-xl",
    userButtonPopoverActionButton:
      "!text-white [color:#ffffff!important] hover:bg-white/10 [&_span]:!text-white",
    userButtonPopoverActionButtonIconBox: "!text-white",
    userButtonPopoverActionButtonIcon: "!text-white [&_svg]:!text-white",
    userButtonPopoverActionButton__manageAccount:
      "!text-white [color:#ffffff!important] hover:bg-white/10",
    userButtonPopoverActionButton__signOut:
      "!text-white [color:#ffffff!important] hover:bg-white/10",
    userButtonPopoverActionButtonIcon__manageAccount: "!text-white [&_svg]:text-white",
    userButtonPopoverActionButtonIcon__signOut: "!text-white [&_svg]:text-white",
  },
};
