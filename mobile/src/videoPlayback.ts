type Player = { readonly playing: boolean; play(): void; pause(): void };

/** Overlay pauses are temporary; leaving the app cancels automatic resumption. */
export function createVideoPlaybackGuard(player: Player) {
  let active = true;
  let overlay = false;
  let resumeAfterOverlay = false;
  return {
    setActive(next: boolean) {
      active = next;
      if (!active) { resumeAfterOverlay = false; player.pause(); }
    },
    setOverlay(next: boolean) {
      if (overlay === next) return;
      overlay = next;
      if (overlay) {
        resumeAfterOverlay = active && player.playing;
        player.pause();
      } else {
        const resume = resumeAfterOverlay && active;
        resumeAfterOverlay = false;
        if (resume) player.play();
      }
    },
  };
}
