// Applies the saved theme before the first paint, so a dark page never flashes light.
try {
  const saved = localStorage.getItem("tenric-ui-theme");
  const dark = saved === "dark" || ((saved === null || saved === "system") && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
} catch { /* storage unavailable: follow the light default */ }
