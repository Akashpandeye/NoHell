import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * UI protection is intentionally opt-in. API handlers still authenticate and
 * authorize every resource themselves; middleware is only an early UX guard.
 */
const isProtectedRoute = createRouteMatcher([
  "/onboarding(.*)",
  "/session(.*)",
  "/pricing(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  if (isProtectedRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
