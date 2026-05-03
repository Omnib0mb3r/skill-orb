/** @type {import('next').NextConfig} */
const DAEMON = process.env.DEVNEURAL_DAEMON_URL ?? 'http://localhost:3747';

const DAEMON_PATHS = [
  'auth',
  'dashboard',
  'sessions',
  'services',
  'projects',
  'reference',
  'reminders',
  'notifications',
  'search',
  'upload',
];

const nextConfig = {
  reactStrictMode: true,
  // Single-origin pattern: every daemon endpoint is reachable from the Next dev
  // server through a transparent rewrite. The daemon issues Set-Cookie on its
  // own response; Next passes the header through; the browser stores it on the
  // Next origin (localhost:3000) which means subsequent fetches carry it back.
  async rewrites() {
    return DAEMON_PATHS.flatMap((p) => [
      { source: `/${p}`,        destination: `${DAEMON}/${p}` },
      { source: `/${p}/:path*`, destination: `${DAEMON}/${p}/:path*` },
    ]);
  },
};

export default nextConfig;
