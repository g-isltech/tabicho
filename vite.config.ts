import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages では https://<owner>.github.io/tabicho/ で公開するため、base を合わせる
export default defineConfig({
  base: '/tabicho/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'japan.json'],
      manifest: {
        name: '旅帳',
        short_name: '旅帳',
        description: '長い旅の行程・予約・お金・やりたいこと・日記を、地図と一緒に管理するアプリ',
        lang: 'ja',
        start_url: '/tabicho/',
        scope: '/tabicho/',
        display: 'standalone',
        theme_color: '#1F4FA0',
        background_color: '#E7EDF0',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: { globPatterns: ['**/*.{js,css,html,json,svg,png}'] }
    })
  ]
});
