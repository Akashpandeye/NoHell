# Project fonts

## Berkeley Mono (preferred)

[Berkeley Mono](https://berkeleygraphics.com/typefaces/berkeley-mono/) is a commercial monospaced typeface. Drop licensed files here so the app can self-host them:

| File | Weight |
|------|--------|
| `BerkeleyMono-Regular.woff2` | 400 |
| `BerkeleyMono-Medium.woff2` | 500 |
| `BerkeleyMono-SemiBold.woff2` | 600 |
| `BerkeleyMono-Bold.woff2` | 700 |

`.woff` variants with the same base names are also picked up.

If no files are present, the stack falls back to:

1. **Local install** of Berkeley Mono (OS font)
2. **IBM Plex Mono** (loaded via `next/font`)
3. System monospace (`ui-monospace`, SF Mono, Menlo, Consolas, …)
