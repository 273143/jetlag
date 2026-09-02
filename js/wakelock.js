// Keeping the screen alight for the length of a round.
//
// A round is twenty minutes of reading a map and arguing about it, with long
// stretches where nobody touches the glass -- exactly the pattern a screen
// timeout exists to catch. On a train that is worse than an annoyance. The
// handover sheet is the only thing keeping the hiding place secret, and a
// phone that locks itself in the middle of being passed across a table drops
// whoever unlocks it back into whatever was on screen before.
//
// The API is best-effort by construction. The browser takes the lock away
// whenever the page stops being visible and refuses to grant a new one until
// it is visible again, so holding one is not "acquire once" but "re-acquire
// on every return" -- which is what the visibilitychange listener is for, and
// why the first attempt failing is not a reason to stop trying.
//
// Nothing here is load-bearing. Chrome on Android has had this since 84, but
// Firefox for Android and every browser with the battery saver on will refuse
// it, and the game plays exactly as before when they do. That is why every
// failure path here is a swallowed error rather than a message: there is
// nothing the player could do about it, and a warning they cannot act on is
// just noise on the one screen that has to stay readable.

let sentinel = null;    // the live lock, or null when we do not hold one
let wanted = false;     // whether we *want* one -- true between the calls below

async function acquire() {
  if (!wanted || sentinel || document.visibilityState !== "visible") return;
  try {
    sentinel = await navigator.wakeLock.request("screen");
    // Fired both when we release it and when the browser does, on the page
    // being hidden. Either way the sentinel is spent, and forgetting it here
    // is what makes the next acquire() on return actually ask for a new one
    // instead of seeing a stale object and doing nothing.
    sentinel.addEventListener("release", () => { sentinel = null; });
  } catch (err) {
    sentinel = null;    // refused: unsupported, battery saver, or not visible
  }
}

/** Ask for the screen to stay on, and keep asking each time we come back. */
export function keepAwake() {
  if (!("wakeLock" in navigator)) return;
  if (!wanted) {
    wanted = true;
    document.addEventListener("visibilitychange", acquire);
  }
  acquire();
}

/** Let it go -- the run is over and the phone can be a phone again. */
export function releaseWake() {
  wanted = false;
  document.removeEventListener("visibilitychange", acquire);
  sentinel?.release().catch(() => {});
  sentinel = null;
}
