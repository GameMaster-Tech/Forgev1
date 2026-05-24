/**
 * Tiny global store for Echo open/close so bell triggers anywhere
 * in the app can speak to the tray rendered once in AppShell.
 */

import { create } from "zustand";

interface EchoStore {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export const useEchoStore = create<EchoStore>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
}));
