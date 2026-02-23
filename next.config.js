/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:8005/api/:path*",
      },
    ];
  },
};

module.exports = nextConfig;
