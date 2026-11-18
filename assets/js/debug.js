/* Eruda Debug Button */
if (new URLSearchParams(location.search).has('debug')) {
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/eruda';
  s.onload = () => eruda.init();
  document.head.appendChild(s);
}
