if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("assets/js/sw.js").catch(() => {
      // Silent fail for non-HTTPS or unsupported contexts.
    });
  });
}
