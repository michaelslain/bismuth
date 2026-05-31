// Debounce utility: returns a wrapped function that delays invoking `fn`
// until `delay` ms have elapsed since the last call. Reusable across components.
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delay: number | (() => number),
): ((...args: Args) => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const debounced = (...args: Args) => {
    if (timer !== undefined) clearTimeout(timer);
    const ms = typeof delay === "function" ? delay() : delay; // read live so settings changes take effect
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, ms);
  };

  debounced.cancel = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  return debounced;
}
