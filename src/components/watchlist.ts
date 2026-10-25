/** Watches started in this browser. The server keeps the watch; this only remembers the links. */
export interface LocalWatch {
  id: string;
  artist: string;
  market: string;
  createdAt: string;
}

const KEY = "tidate:watches";

export function loadLocalWatches(): LocalWatch[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => x && typeof x.id === "string") : [];
  } catch {
    return [];
  }
}

export function saveLocalWatch(w: LocalWatch) {
  try {
    const list = [w, ...loadLocalWatches().filter((x) => x.id !== w.id)].slice(0, 30);
    localStorage.setItem(KEY, JSON.stringify(list));
    window.dispatchEvent(new Event("tidate-watches"));
  } catch {
    /* storage unavailable: the link still works */
  }
}

export function forgetLocalWatch(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadLocalWatches().filter((x) => x.id !== id)));
    window.dispatchEvent(new Event("tidate-watches"));
  } catch {
    /* ignore */
  }
}
