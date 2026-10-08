// Capture credentials before the router mounts. Changing history during render
// can discard React's first render when a route is loaded asynchronously.
const captured = new Map<string, string>();
export function captureAccessFragment() {
  const params = new URLSearchParams(location.hash.slice(1));
  let found = false;
  for (const key of ['access', 'token']) {
    const value = params.get(key);
    if (value) {
      captured.set(`${location.pathname}:${key}`, value);
      found = true;
    }
  }
  if (found)
    history.replaceState(
      history.state,
      '',
      location.pathname + location.search,
    );
}
captureAccessFragment();
export function accessFragment(key: string) {
  return (
    captured.get(`${location.pathname}:${key}`) ||
    new URLSearchParams(location.hash.slice(1)).get(key) ||
    undefined
  );
}
export function forgetAccessFragment(key: string) {
  captured.delete(`${location.pathname}:${key}`);
}
