import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Opt-in protection only (recommended by Clerk).
 * An “invert” list (public routes + protect everything else) breaks sign-out:
 * Clerk’s server actions / RSC requests during logout can hit URLs that are not
 * in the public list and get `auth.protect()` → 404 or a broken state.
 *
 * Add patterns here for routes that require a session (e.g. `/app(.*)`).
 * `/`, `/sign-in`, `/sign-up`, and everything else stay public until listed.
 */
const isProtectedRoute = createRouteMatcher([]);

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
