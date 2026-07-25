(() => {
  const storageKey = "mdbase:theme";
  const root = document.documentElement;
  const media = matchMedia("(prefers-color-scheme: dark)");
  let preference = "system";

  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === "light" || stored === "dark" || stored === "system") preference = stored;
  } catch {
    // The system preference remains available when local storage is unavailable.
  }

  function apply(next, persist = false) {
    preference = next;
    if (next === "system") root.removeAttribute("data-theme");
    else root.dataset.theme = next;
    if (persist) {
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        // Keep the in-memory selection for this page.
      }
    }
    const dark = next === "dark" || (next === "system" && media.matches);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#1c1e24" : "#fcfcfd");
    document.querySelectorAll("[data-theme-select]").forEach((select) => {
      select.value = next;
    });
  }

  apply(preference);
  media.addEventListener("change", () => {
    if (preference === "system") apply("system");
  });
  addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-theme-select]").forEach((select) => {
      select.value = preference;
      select.addEventListener("change", (event) => apply(event.currentTarget.value, true));
    });
  });
})();
