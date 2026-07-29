import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * Node-environment tests only.
 *
 * Everything worth testing today is pure: the two pricing engines, the time
 * model, the supply planner and the voice parser. None of them touch the DOM
 * or the network, which is what makes them worth testing first — they are the
 * arithmetic the business runs on, and they are deterministic.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': resolve(__dirname, '.') },
  },
});
