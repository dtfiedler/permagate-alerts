import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import {
  DockerComposeEnvironment,
  StartedDockerComposeEnvironment,
  Wait,
} from 'testcontainers';
import { knex } from '../src/db/knexfile.js';
import { SqliteDatabase } from '../src/db/sqlite.js';
import fs from 'node:fs';
import { createLogger } from 'winston';

const cleanDb = () => {
  // check if it exists
  if (fs.existsSync(`${process.cwd()}/data/sqlite/core-test.db`)) {
    return fs.promises.unlink(`${process.cwd()}/data/sqlite/core-test.db`);
  }
};
const createDb = async () => {
  await cleanDb();
  return new SqliteDatabase({
    knex,
    logger: createLogger({
      silent: true,
    }),
  });
};
describe('container', function () {
  let compose: StartedDockerComposeEnvironment;
  let database: SqliteDatabase;

  before(async function () {
    database = await createDb();
    compose = await new DockerComposeEnvironment(
      process.cwd(),
      'docker-compose.yaml',
    )
      .withEnvironmentFile(`${process.cwd()}/.env.test`)
      .withWaitStrategy('alerts-1', Wait.forHealthCheck())
      .withBuild()
      .up(['alerts']);
  });

  after(async function () {
    await database.close();
    await compose.down();
  });

  it('should pass the health check', async function () {
    const response = await fetch('http://localhost:3000/healthcheck');
    assert.equal(response.status, 200);
  });

  it('should add a new event to the database when posted to /ar-io/webhook', async function () {
    const response = await fetch('http://localhost:3000/ar-io/webhook', {
      method: 'POST',
      body: JSON.stringify({
        eventType: 'buy-record-notice',
        eventData: {
          record: '123456',
        },
        nonce: 1,
      }),
    });
    assert.equal(response.status, 200);
    const events = await database.getAllEvents();
    assert.equal(events.length, 1);
  });

  it('should throw 202 if the event is already processed', async function () {
    const response = await fetch('http://localhost:3000/ar-io/webhook', {
      method: 'POST',
      body: JSON.stringify({
        eventType: 'buy-record-notice',
        eventData: {
          record: '123456',
        },
        nonce: 1,
      }),
    });
    assert.equal(response.status, 202);
  });
});
