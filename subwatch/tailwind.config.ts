import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#2563eb', light: '#e8f0fe' },
        page: '#f3f5f9',
      },
      maxWidth: { app: '480px' },
    },
  },
  plugins: [],
};

export default config;
