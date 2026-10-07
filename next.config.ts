import type { NextConfig } from 'next';
const config: NextConfig = {
  serverExternalPackages: ['@electric-sql/pglite', 'pg', 'playwright', 'playwright-core'],
  poweredByHeader: false,
};
export default config;
