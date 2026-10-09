/** localStorage that never throws (private mode, blocked storage, etc.). */
export const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : (JSON.parse(v) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
};

export function deviceId(): string {
  let id = storage.get<string | null>("dy.device", null);
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    // randomUUID needs a secure context (https/localhost); fall back for LAN testing over http.
    id =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
            (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16),
          );
    storage.set("dy.device", id);
  }
  return id;
}
