import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'screenshots/*.png'],
      manifest: {
        name:        'جيتك المطور — G-Tech Developer ERP',
        short_name:  'جيتك ERP',
        description: 'نظام إدارة الأعمال المتكامل | أ. علاء غبن | 01014868778',
        start_url:   '/',
        display:     'standalone',
        orientation: 'any',
        background_color: '#0d1117',
        theme_color:      '#0066ff',
        lang:  'ar',
        dir:   'rtl',
        icons: [
          { src:'/icons/icon-72.png',  sizes:'72x72',  type:'image/png', purpose:'maskable any' },
          { src:'/icons/icon-192.png', sizes:'192x192',type:'image/png', purpose:'maskable any' },
          { src:'/icons/icon-512.png', sizes:'512x512',type:'image/png', purpose:'maskable any' },
        ],
        shortcuts: [
          { name:'فاتورة جديدة', url:'/invoices/new', description:'إنشاء فاتورة' },
          { name:'الخزينة',      url:'/cashbox',       description:'عرض الخزينة' },
        ],
        screenshots: [
          { src:'/screenshots/desktop.png', sizes:'1280x720', type:'image/png', form_factor:'wide',   label:'لوحة التحكم' },
          { src:'/screenshots/mobile.png',  sizes:'390x844',  type:'image/png', form_factor:'narrow', label:'النسخة المحمولة' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          { urlPattern: /^https:\/\/fonts\.googleapis\.com/, handler:'StaleWhileRevalidate', options:{ cacheName:'google-fonts-stylesheets' } },
          { urlPattern: /^\/api\//, handler:'NetworkFirst', options:{ cacheName:'api-cache', networkTimeoutSeconds:5,
              cacheableResponse:{ statuses:[0,200] } } },
        ],
      },
    }),
  ],
  server: { proxy: { '/api': { target:'http://localhost:4000', changeOrigin:true } } },
});
