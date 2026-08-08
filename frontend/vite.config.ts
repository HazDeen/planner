import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons.svg'], // твои текущие ресурсы
      manifest: {
        name: 'Ежедневник',
        short_name: 'Planner',
        description: 'Умный ежедневник с ИИ',
        theme_color: '#FFF5F3',
        background_color: '#FFF5F3',
        display: 'standalone', // Заставляет приложение открываться на весь экран
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ]
})