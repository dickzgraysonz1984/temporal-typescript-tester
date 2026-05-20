import { proxyActivities, sleep, patched } from '@temporalio/workflow';
// Only import the activity types
import type * as activities from './activities';

const { greet } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
});

/** A workflow that simply calls an activity */
export async function example(name: string): Promise<string> {
  if (patched('sleep-before-greet')) {
    // New behavior: sleep first, then greet.
    // Runs for all fresh workflow executions started after this change.
    await sleep('10 sec');
  }
  // Old behavior path: greet runs first (no preceding sleep).
  // In-flight workflows that have no 'sleep-before-greet' marker in their
  // history will take this branch during replay, matching their recorded
  // ActivityTaskScheduled at event id 5.
  await greet(name);
  await sleep('2 min');
  return await greet(name);
}
