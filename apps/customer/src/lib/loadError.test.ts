import { classifyLoadError, presentLoadError } from './loadError';

describe('classifyLoadError', () => {
  it.each([
    'Network request failed',
    'TypeError: Network request failed',
    'Failed to fetch',
    'The Internet connection appears to be offline.',
  ])('classifies %s as offline', (message) => {
    expect(classifyLoadError(message)).toBe('offline');
  });

  it.each([
    'Catalog restaurant list failed: connection reset',
    'Catalog menu item fetch failed: timeout',
    'PGRST116: no rows returned',
    'permission denied for table restaurants',
    '',
  ])('classifies %s as a server failure, not offline', (message) => {
    expect(classifyLoadError(message)).toBe('server');
  });
});

describe('presentLoadError', () => {
  it('presents the UX-SPEC § 13 offline copy verbatim', () => {
    expect(presentLoadError('Network request failed')).toEqual({
      glyph: '📡',
      title: 'ไม่มีการเชื่อมต่ออินเทอร์เน็ต',
      actionLabel: 'ลองอีกครั้ง',
    });
  });

  it('presents the UX-SPEC § 13 server-error copy verbatim', () => {
    expect(presentLoadError('Catalog restaurant list failed: connection reset')).toEqual({
      glyph: '⚠️',
      title: 'ระบบมีปัญหาชั่วคราว',
      actionLabel: 'ลองอีกครั้ง',
    });
  });

  it('never fabricates a correlation id in the presented copy', () => {
    // The spec's server-error row names a correlation id; direct Supabase
    // reads have none to show (see the module doc). The presentation must not
    // invent one to look complete.
    const presentation = presentLoadError('boom') as unknown as Record<string, unknown>;
    expect(presentation).not.toHaveProperty('correlationId');
    expect(Object.values(presentation).join(' ')).not.toMatch(/correlation|cid-/i);
  });
});
