import { defineWorkerTestConfig } from './vitest.workers.config';

export default defineWorkerTestConfig({
  include: ['worker/test/clickup-*.test.ts'],
});
