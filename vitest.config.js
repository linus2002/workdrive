import { spawnSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Windows: when the shell's working directory has a lower-case drive letter ("c:\Users\…", common in VS Code
// terminals), Vitest's worker loads a second copy of Vitest and every suite fails with "failed to find the
// current suite". Re-run the same command from the upper-case path instead (the child skips this branch).
const upper = (p) => (p && /^[a-z]:[\\/]/.test(p) ? p[0].toUpperCase() + p.slice(1) : p);
if (process.platform === 'win32' && /^[a-z]:/.test(process.cwd()) && !process.env.VITEST_DRIVE_FIXED) {
  const r = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1).map(upper)], {
    cwd: upper(process.cwd()), stdio: 'inherit', env: { ...process.env, VITEST_DRIVE_FIXED: '1' },
  });
  process.exit(r.status ?? 1);
}

// Unit tests run in plain Node (no jsdom): pure logic plus server-side rendering of components.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.{js,jsx}'],
    testTimeout: 20000,
  },
});
