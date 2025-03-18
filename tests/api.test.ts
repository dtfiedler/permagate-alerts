import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import {
  DockerComposeEnvironment,
  StartedDockerComposeEnvironment,
  Wait,
} from 'testcontainers';
import Knex from 'knex';
import knexConfig from '../src/db/knexfile.js';
import { SqliteDatabase } from '../src/db/sqlite.js';
import fs from 'node:fs';
import { createLogger } from 'winston';
import { ARIO_MAINNET_PROCESS_ID } from '@ar.io/sdk';

const cleanDb = async () => {
  if (fs.existsSync(`${process.cwd()}/data/sqlite/core-test.db`)) {
    return fs.promises.unlink(`${process.cwd()}/data/sqlite/core-test.db`);
  }
};
const createDb = async () => {
  await cleanDb();
  return new SqliteDatabase({
    knex: Knex(knexConfig.test),
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
      .withEnvironment({
        NODE_ENV: 'test',
        MAILGUN_API_KEY: '',
        MAILGUN_DOMAIN: '',
        MAILGUN_FROM_EMAIL: '',
        DEBUG_KNEX: 'false',
      })
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

  it('should store a subscriber with default process subscriptions', async function () {
    const response = await fetch(
      'http://localhost:3000/api/subscribe?email=test@example.com',
      {
        method: 'POST',
        body: JSON.stringify({
          email: 'test@example.com',
        }),
      },
    );
    assert.equal(response.status, 200);
    const subscribers = await database.getAllSubscribers();
    assert.equal(subscribers.length, 1);
  });

  it('should return 400 if no email is provided', async function () {
    const response = await fetch('http://localhost:3000/api/subscribe', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 400);
  });

  it('should return 400 if no processes are provided', async function () {
    const response = await fetch(
      'http://localhost:3000/api/subscribe?email=test@example.com',
      {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', processes: {} }),
      },
    );
    assert.equal(response.status, 400);
  });

  it('should return 200 and store the subscriber with the provided processes', async function () {
    const response = await fetch(
      'http://localhost:3000/api/subscribe?email=test@example.com',
      {
        method: 'POST',
        body: JSON.stringify({
          email: 'test@example.com',
          processes: {
            [ARIO_MAINNET_PROCESS_ID]: [
              {
                eventType: 'buy-name-notice',
                addresses: [],
              },
            ],
          },
        }),
      },
    );
    assert.equal(response.status, 200);
  });

  it('should return 400 if an invalid process is provided', async function () {
    const response = await fetch(
      'http://localhost:3000/api/subscribe?email=test@example.com',
      {
        method: 'POST',
        body: JSON.stringify({
          email: 'test@example.com',
          processes: { invalid: [] },
        }),
      },
    );
    assert.equal(response.status, 400);
  });

  it('should return the total number of subscribers', async function () {
    const response = await fetch('http://localhost:3000/api/subscribers/total');
    assert.equal(response.status, 200);
    const subscribers = await response.json();
    assert.equal(subscribers.total, 1);
  });
});
