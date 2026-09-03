import * as migration_20260903_072748_initial from './20260903_072748_initial';

export const migrations = [
  {
    up: migration_20260903_072748_initial.up,
    down: migration_20260903_072748_initial.down,
    name: '20260903_072748_initial'
  },
];
