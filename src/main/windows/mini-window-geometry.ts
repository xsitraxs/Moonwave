/** Native window operations used to enter mini mode (kept separate for platform-order regression tests). */
export interface MiniWindowGeometry {
  unmaximize(): void;
  setResizable(value: boolean): void;
  setMaximizable(value: boolean): void;
  setMinimumSize(width: number, height: number): void;
  setSize(width: number, height: number): void;
}

export function enterMiniGeometry(win: MiniWindowGeometry, maximized: boolean): void {
  if (maximized) win.unmaximize();
  // On Windows making the window non-resizable freezes its current size. Resize first, then lock it.
  win.setResizable(true);
  win.setMinimumSize(380, 180);
  win.setSize(480, 200);
  win.setMaximizable(false);
  win.setResizable(false);
}
