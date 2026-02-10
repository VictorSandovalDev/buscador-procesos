import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === 'production';

const nextConfig: NextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  // IMPORTANT: The basePath must match your repository name.
  // If your repo is https://github.com/vimasaba44/buscador-procesos, then use '/buscador-procesos'
  basePath: isProd ? '/buscador-procesos' : '',
  assetPrefix: isProd ? '/buscador-procesos/' : '',
};

export default nextConfig;
