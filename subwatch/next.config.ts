import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 開発中に読み込みが2回走ると、画面テストの mockApi の順番の応答がずれるため false にする
  reactStrictMode: false,
  // 開発中に出る Next.js のボタンが下部ナビに重なって押せなくなるため出さない
  devIndicators: false,
  // 画面テスト（Playwright）は 127.0.0.1 で開くので、開発中の読み込みを許す
  allowedDevOrigins: ['127.0.0.1'],
};

export default nextConfig;
