// Service Worker mínimo — necessário para o Chrome liberar a instalação PWA.
// Não faz cache agressivo para evitar problemas de atualização.

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    // Handler vazio — necessário para o Chrome reconhecer como PWA instalável.
});
