

# PWA Setup Plan

## What will be done

Install `vite-plugin-pwa` and configure it to make the app installable from the browser on any device.

## Technical steps

1. **Install `vite-plugin-pwa`** as a dev dependency

2. **Update `vite.config.ts`** — add `VitePWA` plugin with:
   - App manifest (name: "SiteJob", theme color, icons)
   - `navigateFallbackDenylist: [/^\/~oauth/]` to protect OAuth flows
   - `registerType: 'autoUpdate'` for seamless updates

3. **Add PWA icons** — create `public/pwa-192x192.png` and `public/pwa-512x512.png` (generated from existing favicon or placeholder)

4. **Update `index.html`** — add mobile meta tags:
   - `<meta name="theme-color">`
   - `<link rel="apple-touch-icon">`
   - `<meta name="apple-mobile-web-app-capable">`

5. **Create `/installeren` page** — simple install prompt page with:
   - Instructions for iOS (Share → Add to Home Screen) and Android (browser menu)
   - `beforeinstallprompt` event handler for supported browsers
   - Add route to `App.tsx`

## Result

The app becomes installable from the browser. Users can add it to their home screen and it works offline-capable with auto-updating service worker.

