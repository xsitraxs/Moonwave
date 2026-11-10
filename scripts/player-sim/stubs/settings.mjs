import { create } from "zustand";
export const useSettings = create(() => ({ prefs: { substitute: false, noSubstitute: [], autopilot: true }, history: [], volume: 0.8, muted: false, save() {}, setPref() {} }));
