export type Theme = 'dark' | 'light';
const key = 'gameatlas-theme';
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle('dark', theme === 'dark');
}
export function initializeTheme() {
  let theme: Theme = 'dark';
  try { if (localStorage.getItem(key) === 'light') theme = 'light'; } catch {}
  applyTheme(theme);
}
export function saveTheme(theme: Theme) {
  applyTheme(theme);
  try { localStorage.setItem(key, theme); } catch {}
}
