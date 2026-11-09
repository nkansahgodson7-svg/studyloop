import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';

// Next's App Router emits inline bootstrap scripts, so script-src needs
// 'unsafe-inline' unless nonces are wired through middleware. Everything else
// is locked to same-origin (fonts are self-hosted via @fontsource-variable).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }
];

const nextConfig: NextConfig = {
  devIndicators: false,
  experimental: {
    staleTimes: {
      dynamic: 30,
      static: 180
    }
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  }
};

export default nextConfig;
