/**
 * The new-order arrival tone (M-03) — a short synthesized beep via the
 * browser's own Web Audio API, not a bundled audio file.
 *
 * This is the smallest reliable browser-native option: no asset to add under
 * `apps/merchant/public/`, nothing to download, and nothing to bundle beyond
 * what every modern browser already ships. `AudioContext` is created lazily
 * (only when `play()` is first called), not at module load, so importing
 * this file has no side effect and is safe under SSR and in Jest/jsdom
 * (which has no `AudioContext` at all — see `ensureContext`'s feature check).
 *
 * ## Autoplay policy, handled honestly
 *
 * A browser may start a fresh `AudioContext` in the `'suspended'` state until
 * the page has seen a user gesture. `play()` below always attempts
 * `context.resume()` first and reports the real outcome — `{ played: false,
 * reason: 'blocked' }` when the browser refuses — rather than claiming a tone
 * played when it did not. Calling `play()` from inside a click handler (the
 * sound-toggle button) is a legitimate user gesture and is what actually
 * unlocks the context for later, unattended calls from the arrival-alert
 * hook.
 */

export type AlertPlayReason = 'unsupported' | 'blocked' | 'error';

export interface AlertPlayResult {
  played: boolean;
  reason?: AlertPlayReason;
}

export interface AlertPlayer {
  play(): Promise<AlertPlayResult>;
}

type AudioContextCtor = new () => AudioContext;

function resolveAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function createAlertPlayer(): AlertPlayer {
  let context: AudioContext | null = null;

  function ensureContext(): AudioContext | null {
    if (context) return context;
    const Ctor = resolveAudioContextCtor();
    if (!Ctor) return null;
    try {
      context = new Ctor();
    } catch {
      context = null;
    }
    return context;
  }

  async function play(): Promise<AlertPlayResult> {
    const ctx = ensureContext();
    if (!ctx) return { played: false, reason: 'unsupported' };

    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        return { played: false, reason: 'blocked' };
      }
    }

    if (ctx.state !== 'running') return { played: false, reason: 'blocked' };

    try {
      // Two short rising beeps — audible across a kitchen without being a
      // siren. Copy/visuals are the design's; this tone is not — no design
      // artifact specifies a waveform, so this is the smallest DESIGN CHOICE
      // needed to make the specified "audible alert" real (see the M-2.7
      // precedent for this class of implementer latitude).
      const now = ctx.currentTime;
      for (const offset of [0, 0.18]) {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, now + offset);
        gain.gain.setValueAtTime(0, now + offset);
        gain.gain.linearRampToValueAtTime(0.22, now + offset + 0.02);
        gain.gain.linearRampToValueAtTime(0, now + offset + 0.15);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start(now + offset);
        oscillator.stop(now + offset + 0.16);
      }
      return { played: true };
    } catch {
      return { played: false, reason: 'error' };
    }
  }

  return { play };
}
