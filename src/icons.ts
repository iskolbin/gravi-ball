const paths = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  coin: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>',
  skull:
    '<path d="M12 3a7 7 0 0 0-7 7c0 2.5 1.3 4.5 3 5.7V19h8v-3.3c1.7-1.2 3-3.2 3-5.7a7 7 0 0 0-7-7z"/><circle cx="9.5" cy="10.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="14.5" cy="10.5" r="1.3" fill="currentColor" stroke="none"/>',
  arrow: '<path d="M12 4v14m0 0l-5-5m5 5l5-5"/>',
  trophy:
    '<path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M8 5H5a3 3 0 0 0 3 4M16 5h3a3 3 0 0 1-3 4M12 13v4m-4 3h8"/>',
  check: '<path d="M5 13l4 4L19 7"/>',
  star: '<path d="M12 4l2.4 5 5.6.7-4 3.8 1 5.5-5-2.8-5 2.8 1-5.5-4-3.8 5.6-.7z"/>',
  note: '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M4 8l8 6 8-6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-3-6.3M20 4v5h-5"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  shrink: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  // editor toolbar
  select: '<path d="M6 3l13 9.5-6.3 1 3.6 6.5-2.9 1.5-3.5-6.5L6 18z"/>',
  wall: '<rect x="4" y="8" width="16" height="8" rx="1"/>',
  sticky: '<path d="M12 4c3 4.5 5 7.5 5 10a5 5 0 0 1-10 0c0-2.5 2-5.5 5-10z"/>',
  bouncy: '<path d="M5 19C9 10 13 8 19 5M14 5h5v5"/>',
  spike: '<path d="M4 18L9 8l4 7 3-9 4 12z"/>',
  accel: '<path d="M4 12h13m0 0l-5-5m5 5l-5 5"/>',
  brake: '<circle cx="12" cy="12" r="8"/><path d="M12 8v5m0 2v.01"/>',
  mover: '<path d="M4 12h16M20 12l-4-4m4 4l-4 4M4 12l4-4m-4 4l4 4"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  play: '<path d="M8 6l10 6-10 6z"/>',
  erase: '<path d="M6 6l12 12M18 6L6 18"/>',
} as const;

export type IconName = keyof typeof paths;

/** Inline stroke icon (inherits currentColor). */
export function icon(name: IconName, size = 18): string {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}
