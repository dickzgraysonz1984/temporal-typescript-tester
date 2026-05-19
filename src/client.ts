import { Connection, Client } from '@temporalio/client';
import { loadClientConnectConfig } from '@temporalio/envconfig';
import { example } from './workflows';
import { nanoid } from 'nanoid';

async function run() {
  const count = Math.max(1, parseInt(process.argv[2] ?? '1', 10) || 1);
  const config = loadClientConnectConfig();
  const connection = await Connection.connect(config.connectionOptions);
  const client = new Client({ connection });

  const results = await Promise.allSettled(
    Array.from({ length: count }, () =>
      client.workflow.start(example, {
        taskQueue: 'hello-world',
        // type inference works! args: [name: string]
        args: ['Temporal'],
        // in practice, use a meaningful business ID, like customerId or transactionId
        workflowId: 'workflow-' + nanoid(),
      }),
    ),
  );
  for (const result of results) {
    if (result.status === 'fulfilled') {
      console.log(`Started workflow ${result.value.workflowId}`);
    } else {
      console.error(`Failed to start workflow:`, result.reason);
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
