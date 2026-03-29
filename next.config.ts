import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    /** Avoids flaky dev bundler errors around segment-explorer / SegmentViewNode (Next 15+). */
    devtoolSegmentExplorer: false,
  },
};

export default nextConfig;
