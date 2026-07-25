import { describe, expect, it } from 'vitest';

import { hasWorkingMarker } from './geo-fleet.js';

describe('hasWorkingMarker', () => {
  it('does not treat a created but idle tmux pane as a live lane', () => {
    expect(hasWorkingMarker('› Explain this codebase\n\ngpt-5.6-terra xhigh fast · ~/src/geo')).toBe(false);
  });

  it('recognizes the CLI working marker', () => {
    expect(hasWorkingMarker('• Working (2m 53s • esc to interrupt)')).toBe(true);
  });
});
