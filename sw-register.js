if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      // Silent fail for non-HTTPS or unsupported contexts.
    });
  });
}
