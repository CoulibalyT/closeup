import { brand } from '@closeup/shared';

// The one place the player-facing name is decided: title, PWA manifest and every i18n string
// (through `{appName}`) read it from here.
const appName = process.env.CLOSEUP_DISPLAY_NAME || brand.displayName;

export default defineNuxtConfig({
  compatibilityDate: '2026-09-01',
  devtools: { enabled: false },

  // Production is a static build served by Caddy: no Node process, so nothing can run on the
  // server anyway (language detection included). Game, screen and admin routes stay client
  // rendered; the landing page will opt back into prerendering through routeRules.
  ssr: false,
  modules: ['@pinia/nuxt', '@nuxtjs/i18n', '@vite-pwa/nuxt'],
  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    public: {
      appName,
      // Empty in production: Caddy serves the web app and /api from one origin.
      // In dev the browser talks to the API container directly (NUXT_PUBLIC_API_BASE).
      apiBase: '',
    },
  },

  app: {
    head: {
      title: appName,
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        // Two colours: the bar matches the page in either scheme.
        { name: 'theme-color', content: '#e9edf3', media: '(prefers-color-scheme: light)' },
        { name: 'theme-color', content: '#0c1130', media: '(prefers-color-scheme: dark)' },
      ],
      // The theme chosen on this device, applied before the first paint (no flash of the
      // default colours). Same key as useTheme.
      script: [
        {
          innerHTML:
            "try{var t=localStorage.getItem('closeup-theme');if(t==='light'||t==='rose'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}",
        },
      ],
      link: [
        { rel: 'icon', href: '/icon.svg', type: 'image/svg+xml' },
        { rel: 'icon', href: '/favicon.png', sizes: '48x48', type: 'image/png' },
        // iOS reads this one for the home screen, never the manifest.
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png', sizes: '180x180' },
      ],
    },
  },

  i18n: {
    strategy: 'prefix_except_default',
    defaultLocale: 'fr',
    locales: [
      { code: 'fr', language: 'fr-FR', name: 'Français', file: 'fr.json' },
      { code: 'en', language: 'en-GB', name: 'English', file: 'en.json' },
    ],
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: `${brand.codename}_locale`,
      redirectOn: 'root',
      // The PWA always starts on "/": without this, someone who chose English would land on the
      // French page at every launch (the default only redirects on the very first visit).
      alwaysRedirect: true,
      fallbackLocale: 'en',
    },
  },

  pwa: {
    registerType: 'autoUpdate',
    manifest: {
      name: appName,
      short_name: appName,
      description: 'Un détail en très gros plan. Trouve ce que c’est avant que l’image recule.',
      lang: 'fr',
      display: 'standalone',
      orientation: 'portrait',
      start_url: '/',
      scope: '/',
      categories: ['games', 'entertainment'],
      // The "sheet metal" background of the Photomaton tokens (assets/css/main.css).
      background_color: '#e9edf3',
      theme_color: '#e9edf3',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        // The drawing fits the middle 80%, so the same file survives any mask.
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      ],
    },
    workbox: {
      navigateFallback: '/',
      // Game content must always come from the API so a pack can be switched off instantly.
      navigateFallbackDenylist: [/^\/api\//],
      globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      // A crop is behind a URL that expires in 45 seconds: caching one would only store a 404.
      runtimeCaching: [],
      cleanupOutdatedCaches: true,
    },
    devOptions: { enabled: true, type: 'module', suppressWarnings: true },
  },
});
