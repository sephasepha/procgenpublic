// Offline support and home-screen install. Fails quietly where service workers are unavailable.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}

window.addEventListener('load', () => { const b = document.getElementById('build'); if (b && window.BUILD) b.textContent = 'Build ' + window.BUILD; });
