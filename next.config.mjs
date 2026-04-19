/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The dashboard payload in KV is the source of truth — we don't want Next
  // serving stale HTML, so all data flows through the /api/whoop route.
};

export default nextConfig;
