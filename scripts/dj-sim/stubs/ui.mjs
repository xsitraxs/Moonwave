import { create } from "zustand";

/** The toast/skip side of the UI store: the player and the room announce things, nothing is on screen here. */
export const useUi = create(() => ({ noteSkipped() {}, showToast() {}, openSideQueue() {}, openMenu() {} }));
