/**
 * Notification store — in-memory client store with localStorage
 * persistence so reloads don't lose state.
 *
 * Singleton: a single store per browser tab. Subscribers are notified
 * on every mutation.
 */

import type { Notification, NotificationStore } from "./types";

const STORAGE_KEY = "forge.notifications.v1";
const MAX_ENTRIES = 200;

class InMemoryNotificationStore implements NotificationStore {
  private items: Notification[] = [];
  private subs = new Set<(s: Notification[]) => void>();
  private hydrated = false;
  private counter = 0;

  private hydrate(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Notification[];
      if (Array.isArray(parsed)) this.items = parsed.slice(0, MAX_ENTRIES);
    } catch {/* ignore */}
  }

  private persist(): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items.slice(0, MAX_ENTRIES)));
    } catch {/* quota etc. */}
  }

  private emit(): void {
    const snap = [...this.items];
    for (const fn of this.subs) {
      try { fn(snap); } catch {/* swallow */}
    }
  }

  list(filter: { unreadOnly?: boolean; limit?: number } = {}): Notification[] {
    this.hydrate();
    let out = [...this.items];
    if (filter.unreadOnly) out = out.filter((n) => !n.read);
    if (filter.limit) out = out.slice(0, filter.limit);
    return out;
  }

  push(args: Omit<Notification, "id" | "read" | "at"> & { at?: number }): Notification {
    this.hydrate();
    const id = `n_${Date.now().toString(36)}_${(this.counter++).toString(36)}`;
    const next: Notification = {
      ...args,
      id,
      at: args.at ?? Date.now(),
      read: false,
    };
    this.items.unshift(next);
    if (this.items.length > MAX_ENTRIES) this.items.length = MAX_ENTRIES;
    this.persist();
    this.emit();
    return next;
  }

  markRead(id: string): void {
    this.hydrate();
    let changed = false;
    this.items = this.items.map((n) => {
      if (n.id === id && !n.read) { changed = true; return { ...n, read: true }; }
      return n;
    });
    if (changed) { this.persist(); this.emit(); }
  }

  markAllRead(): void {
    this.hydrate();
    let changed = false;
    this.items = this.items.map((n) => {
      if (!n.read) { changed = true; return { ...n, read: true }; }
      return n;
    });
    if (changed) { this.persist(); this.emit(); }
  }

  clearAll(): void {
    this.hydrate();
    if (this.items.length === 0) return;
    this.items = [];
    this.persist();
    this.emit();
  }

  unreadCount(): number {
    this.hydrate();
    return this.items.reduce((acc, n) => (n.read ? acc : acc + 1), 0);
  }

  subscribe(fn: (snapshot: Notification[]) => void): () => void {
    this.hydrate();
    this.subs.add(fn);
    // Fire immediately so subscribers get the current state.
    try { fn([...this.items]); } catch {/* swallow */}
    return () => { this.subs.delete(fn); };
  }
}

const SINGLETON = new InMemoryNotificationStore();
export function getNotificationStore(): InMemoryNotificationStore {
  return SINGLETON;
}
