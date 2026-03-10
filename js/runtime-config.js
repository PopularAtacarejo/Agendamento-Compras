/**
 * Resolve a URL da API antes do app carregar.
 *
 * Prioridade:
 * 1. valor definido em config.js
 * 2. fallback local em localhost
 * 3. fallback do Render
 */
(function () {
    const configured = (window.API_URL || '').trim();
    if (configured) {
        return;
    }

    const host = window.location.hostname;

    if (host === 'localhost' || host === '127.0.0.1') {
        window.API_URL = 'http://localhost:8000';
        return;
    }

    if (host === 'agendamento-web.onrender.com') {
        window.API_URL = 'https://backendcompras-5vn2.onrender.com';
    }
})();
