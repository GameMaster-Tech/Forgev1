"use client";

/**
 * useNotifications — React subscription to the notification store.
 *
 * Returns the current list, unread count, and the dispatch + mutation
 * helpers. Re-renders on every store update.
 */

import { useCallback, useEffect, useState } from "react";
import { getNotificationStore } from "@/lib/notifications";
import type { Notification } from "@/lib/notifications";

export function useNotifications() {
  const [items, setItems] = useState<Notification[]>([]);

  useEffect(() => {
    const store = getNotificationStore();
    return store.subscribe((snap) => setItems(snap));
  }, []);

  const unreadCount = items.reduce((acc, n) => (n.read ? acc : acc + 1), 0);

  const markRead = useCallback((id: string) => {
    getNotificationStore().markRead(id);
  }, []);

  const markAllRead = useCallback(() => {
    getNotificationStore().markAllRead();
  }, []);

  const clearAll = useCallback(() => {
    getNotificationStore().clearAll();
  }, []);

  return { items, unreadCount, markRead, markAllRead, clearAll };
}
