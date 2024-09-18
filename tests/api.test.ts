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
describe('photo-enhancer', function () {
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
});
