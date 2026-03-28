import { dark } from "@clerk/themes";

export const clerkAppearance = {
  baseTheme: dark,
  variables: {
    colorPrimary: "#14b8a6",
    colorBackground: "#040807",
    colorInputBackground: "#0c1413",
    colorText: "#ecfdf5",
    colorTextSecondary: "#7a9e99",
    colorNeutral: "#1f2e2c",
    borderRadius: "0.75rem",
  },
  elements: {
    card: "border border-[#1f2e2c] bg-[#0c1413] shadow-none",
    headerTitle: "font-sans",
    headerSubtitle: "font-sans",
    socialButtonsBlockButton: "font-sans",
    formButtonPrimary: "font-sans",
    footerActionLink: "text-[#14b8a6]",
  },
};
