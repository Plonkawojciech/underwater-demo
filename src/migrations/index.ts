import * as migration_20260904_071943_initial from './20260904_071943_initial';

export const migrations = [
  {
    up: migration_20260904_071943_initial.up,
    down: migration_20260904_071943_initial.down,
    name: '20260904_071943_initial'
  },
];
