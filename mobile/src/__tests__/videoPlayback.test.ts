import test from 'node:test';
import assert from 'node:assert/strict';
import { createVideoPlaybackGuard } from '../videoPlayback';

function fixture(playing: boolean) {
  const calls: string[] = [];
  const player = {
    playing,
    play() { this.playing = true; calls.push('play'); },
    pause() { this.playing = false; calls.push('pause'); },
  };
  return { player, calls, guard: createVideoPlaybackGuard(player) };
}

test('a playing clip pauses behind an overlay and resumes when it closes', () => {
  const { player, calls, guard } = fixture(true);
  guard.setOverlay(true);
  assert.equal(player.playing, false);
  guard.setOverlay(false);
  assert.equal(player.playing, true);
  assert.deepEqual(calls, ['pause', 'play']);
});

test('a manually paused clip stays paused after opening and closing an overlay', () => {
  const { player, calls, guard } = fixture(false);
  guard.setOverlay(true); guard.setOverlay(false);
  assert.equal(player.playing, false);
  assert.deepEqual(calls, ['pause']);
});

test('repeated overlay updates retain the original playback state without duplicate actions', () => {
  const { calls, guard } = fixture(true);
  guard.setOverlay(false); guard.setOverlay(true); guard.setOverlay(true);
  guard.setOverlay(false); guard.setOverlay(false);
  assert.deepEqual(calls, ['pause', 'play']);
});

test('leaving the app cancels overlay resumption even after returning to the foreground', () => {
  for (const returnBeforeClosing of [false, true]) {
    const { player, calls, guard } = fixture(true);
    guard.setOverlay(true); guard.setActive(false);
    if (returnBeforeClosing) guard.setActive(true);
    guard.setOverlay(false); guard.setActive(true);
    assert.equal(player.playing, false);
    assert.equal(calls.includes('play'), false);
    // A later, deliberate playback session can still use overlay pause/resume.
    player.play(); guard.setOverlay(true); guard.setOverlay(false);
    assert.equal(player.playing, true);
  }
});
