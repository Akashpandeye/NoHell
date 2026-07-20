# Session rail and AI fallback design

## Scope

Fix the closed active-sessions control so it reserves layout space like the existing Notes rail, and add a server-side OpenRouter fallback from HY3 to NVIDIA Nemotron 3 Ultra.

## Session rail

The closed active-sessions control will be an in-flow, fixed-width left rail in the session main flex layout. It will replace the absolute-positioned book button. When sessions are open, the existing 15rem sessions sidebar occupies the same left-side layout position. This prevents it from overlapping the video at any supported viewport size.

## AI fallback

`OPENROUTER_MODEL` remains the primary model setting. `completeWithOpenRouter` sends the existing request to that model first. If the request is unsuccessful, it retries the same request once using `nvidia/nemotron-3-ultra-550b-a55b:free`. If the fallback fails, the function surfaces the fallback error, retaining the current route-level error handling.

The fallback is intentionally fixed in server code: it is an availability backup, not a user-configurable model selector.

## Validation

A small Node contract test will stub `fetch` to verify the primary model is attempted first, the NVIDIA model is used once after failure, and successful primary responses do not trigger the fallback. Existing lint and contract checks will also run.
