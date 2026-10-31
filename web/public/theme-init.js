// Applies the saved theme before first paint to avoid a flash. Kept as a file
// (not inline) so the Content-Security-Policy can forbid inline scripts.
try {
  const t = localStorage.getItem('leaguemates-theme');
  const dark =
    t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
} catch {
  // Storage unavailable (private mode): fall back to the light theme.
}
