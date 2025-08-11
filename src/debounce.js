function debounce(fn, wait) {
  let timer = null;
  return function debounced(...args) {
    const ctx = this;
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(ctx, args), wait);
  };
}

function rafThrottle(fn) {
  let running = false;
  return function throttled(...args) {
    if (running) return;
    running = true;
    requestAnimationFrame(() => {
      fn.apply(this, args);
      running = false;
    });
  };
}

function rafDebounce(fn, wait = 50) {
  const d = debounce(() => requestAnimationFrame(fn), wait);
  return function (...args) { d.apply(this, args); };
}

// UMD-ish export
window.debounce = debounce;
window.rafThrottle = rafThrottle;
window.rafDebounce = rafDebounce;
