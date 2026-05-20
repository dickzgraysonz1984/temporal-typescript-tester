import { proxyActivities, sleep, patched } from '@temporalio/workflow';
import type * as activities from './activities';

const { greet } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
});

export async function example(name: string): Promise<string> {
  if (patched('sleep-before-greet')) {
    await sleep('10 sec');
  }
  await greet(name);
  await sleep('2 min');
  return await greet(name);
}