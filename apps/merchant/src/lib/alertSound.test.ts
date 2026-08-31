import { createAlertPlayer } from './alertSound';

/**
 * jsdom has no `AudioContext` at all, so these tests supply a minimal fake on
 * `window` for the "supported" cases and delete it for the "unsupported"
 * case — there is no real audio hardware or codec involved either way.
 */

class FakeGainNode {
  gain = { setValueAtTime: jest.fn(), linearRampToValueAtTime: jest.fn() };
  connect = jest.fn();
}

class FakeOscillatorNode {
  type = 'sine';
  frequency = { setValueAtTime: jest.fn() };
  connect = jest.fn();
  start = jest.fn();
  stop = jest.fn();
}

class FakeAudioContext {
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  currentTime = 0;
  destination = {};
  resume = jest.fn(async () => {
    this.state = 'running';
  });
  createOscillator = jest.fn(() => new FakeOscillatorNode());
  createGain = jest.fn(() => new FakeGainNode());
}

describe('createAlertPlayer — unsupported browser', () => {
  const original = (window as unknown as { AudioContext?: unknown }).AudioContext;

  beforeEach(() => {
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
  });

  afterEach(() => {
    (window as unknown as { AudioContext?: unknown }).AudioContext = original;
  });

  it('reports unsupported rather than throwing when there is no AudioContext', async () => {
    const player = createAlertPlayer();
    const result = await player.play();
    expect(result).toEqual({ played: false, reason: 'unsupported' });
  });
});

describe('createAlertPlayer — supported browser', () => {
  let fakeCtx: FakeAudioContext;

  beforeEach(() => {
    (window as unknown as { AudioContext: new () => FakeAudioContext }).AudioContext = jest.fn(() => {
      fakeCtx = new FakeAudioContext();
      return fakeCtx;
    }) as unknown as new () => FakeAudioContext;
  });

  afterEach(() => {
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
  });

  it('resumes a suspended context and reports a genuine play', async () => {
    const player = createAlertPlayer();
    const result = await player.play();
    expect(result).toEqual({ played: true });
    expect(fakeCtx.resume).toHaveBeenCalled();
    expect(fakeCtx.createOscillator).toHaveBeenCalled();
  });

  it('reuses one context across multiple play() calls rather than creating a new one each time', async () => {
    const player = createAlertPlayer();
    await player.play();
    await player.play();
    expect((window.AudioContext as unknown as jest.Mock).mock.calls.length).toBe(1);
  });

  it('reports blocked, honestly, when the browser refuses to resume', async () => {
    (window as unknown as { AudioContext: new () => FakeAudioContext }).AudioContext = jest.fn(() => {
      fakeCtx = new FakeAudioContext();
      fakeCtx.resume = jest.fn(async () => {
        // Browser silently refuses — state never leaves 'suspended'.
      });
      return fakeCtx;
    }) as unknown as new () => FakeAudioContext;

    const player = createAlertPlayer();
    const result = await player.play();
    expect(result).toEqual({ played: false, reason: 'blocked' });
  });

  it('reports blocked when resume() itself rejects', async () => {
    (window as unknown as { AudioContext: new () => FakeAudioContext }).AudioContext = jest.fn(() => {
      fakeCtx = new FakeAudioContext();
      fakeCtx.resume = jest.fn(async () => {
        throw new Error('NotAllowedError');
      });
      return fakeCtx;
    }) as unknown as new () => FakeAudioContext;

    const player = createAlertPlayer();
    const result = await player.play();
    expect(result).toEqual({ played: false, reason: 'blocked' });
  });

  it('does not throw if oscillator construction itself fails', async () => {
    (window as unknown as { AudioContext: new () => FakeAudioContext }).AudioContext = jest.fn(() => {
      fakeCtx = new FakeAudioContext();
      fakeCtx.createOscillator = jest.fn(() => {
        throw new Error('boom');
      });
      return fakeCtx;
    }) as unknown as new () => FakeAudioContext;

    const player = createAlertPlayer();
    const result = await player.play();
    expect(result).toEqual({ played: false, reason: 'error' });
  });
});
