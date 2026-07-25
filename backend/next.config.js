/** @type {import('next').NextConfig} */
const nextConfig = {
  // Endpoints de API pura — não precisamos de otimização de imagem/páginas.
  reactStrictMode: true,
  async headers() {
    return [
      {
        // Nunca deixar isso ser indexado/cacheado por engano.
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
