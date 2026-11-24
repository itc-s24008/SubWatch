import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 開発中に読み込みが2回走ると、画面テストの mockApi の順番の応答がずれるため false にする
  reactStrictMode: false,
  // 開発中に出る Next.js のボタンが下部ナビに重なって押せなくなるため出さない
  devIndicators: false,
};

export default nextConfig;
