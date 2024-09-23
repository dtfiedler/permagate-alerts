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

  const testEvent = {
    "data":{
      "anchor":"MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwNjY3MzU",
      "data_hash":"boF42W7nASpb4eqkV15tYqdjX1yN1B8-fwc0vkHJDoc",
      "data_offset":1258188,"data_size":180,
      "filter":"{\"tags\":[{\"name\":\"From-Process\",\"value\":\"agYcCFJtrMG6cqMuZfskIkFTGvUPddICmtQSBIoPdiA\"},{\"name\":\"Action\",\"value\":\"Buy-Record-Notice\"}]}","id":"AZA1Qitr2sOAWxQpejlcNFdOOriNNgCAERo_2R5PGho","index":210,"offset":1256807,"owner":"kePMooMn7uEakQJCE_4DtzcJUPs6x6d-9nG6Pjg84qJqYM9G7-eIg7Enrg-OEqGTjIoreE7tnTB5z66TqQnllSJa8QNDqHbdN1efAs9RknriT62W7Cyqoz_ErjVhc7Wfx02oQm-SpaUSdo1k8orAJ94ADmw_SbCbceCNirStjcNGJ7x1FSj9iNViETvgEmTICYIlyud8C-FU7oLYjEnlAIwUggrP87uEKyp4a1OLDosxGymIZ7F2yue2d1Y0VXl2vhUOvYrvBvAbPUzuOV0x1sajSz33w9uMdZJceOQbxdj3tgWECvzdNTVincyH8wME1-24Wdqki26SEWqvsjTyjpOctT5MC3riEemjv2KXncXf6-vzPGIdl34MbOu5HkmaxBnUrPsm6xPv6JgbthqJCVbvqQ0dFqqHKARU0g5vYpyAXKjjBJvWjKvUHoK_2hSkpLFaf_GHy3ap1MnYELazK5-Rt7yO1Wq6lPfgPRkROOWP0nCZCcDFpyIrA7Wr_BuZ-pzMHquBYV5i3pCWCuFtanTVlVC7EmPSEMIPCBwIVgBeLVMgAoPgwWB3RqD7JvjMcGvDCONflVRf6NoJjXwuzU8ZBp33cqc-XWAVhrAcd0AGt1N0-7riZSmvEWhpjNrc90ODe01gj55dj5LUFvTO0nmHeyVSMsAKmChacU3-C50","owner_address":"fcoN_xJeisVsPXA-trzVAuIiqO3ydLQxM-L4XbrQKzY","owner_offset":1257321,"owner_size":512,"parent_id":"hVNb-8pnSQICTc-tjS82hoCxstcsuNojKmmufPevgcQ","parent_index":-1,"root_tx_id":"hVNb-8pnSQICTc-tjS82hoCxstcsuNojKmmufPevgcQ","signature":"kW4cL--61i5oA1_2ot4R8ZVW2fT45E9c4LwdXDLOksgXKE4j_lC4G6Djnf3uxKseITs28fjWcJ1_d_tnounzK6gjjhzwBI-zmQA-uwbYE77pMuh_nMjZL_PzduDO8u-9_WdEVvLyeDqozeGXhudX6OsxFe9lzADCEA01lcoqzFZho6hmVrRJUMx_B-z-UPEwQOzF5ZHrapVQrPWtCeZkEEIFTl_A3DWSakTFP_l1JuUWjTxF5P4JmeXDb4nxuhZnfAbyx9_sxJ328MQueTLBPTfQh1dutCmWg4IKlLKSpUiGilN9-aLNpo3vbmRRWMwsiI0PicBDthS0SEMNyMjiHO_YbJk24R4y9xDVXeNg0rGbTG8YqjDCID0Ko7gy5maa8z39IN2GzEN2y_RwJqIWPReaTsNht__hlvGLCI1EJPeeIk3heoTYXynEKgb-IzMUAu1o0B6pIxLmEv0j4NnHNHtpJzE6n1HlSDpiAGjet13K8vl2E74FI1lG-wR_aV3e1RYWti5KrBEKLzqPbDzGG_ByzRs_PWy_gTodkqopeVUhWXv00VHum8TMztc8Bl2Dl-yOtmKtaJYBNI14Nbr5wtF-ZreR1y4OgwK9sAApkWBbNgEQMEBnlrC5nQDdbd0YdGSQwjmHGXxmK0Vk_aGeQNXru1CILpoBOunv17y96Gs","signature_offset":1256809,"signature_size":512,"signature_type":1,"size":1561,
      "tags":[
        {"name":"UmVmXw","value":"NjY3MzU"},
        {"name":"TmFtZQ","value":"dGVzdC13ZWJob29rLTEy"},
        {"name":"QWN0aW9u","value":"QnV5LVJlY29yZC1Ob3RpY2U"},
        {"name":"RGF0YS1Qcm90b2NvbA","value":"YW8"},
        {"name":"VHlwZQ","value":"TWVzc2FnZQ"},
        {"name":"VmFyaWFudA","value":"YW8uVE4uMQ"},
        {"name":"RnJvbS1Qcm9jZXNz","value":"YWdZY0NGSnRyTUc2Y3FNdVpmc2tJa0ZUR3ZVUGRkSUNtdFFTQklvUGRpQQ"},
        {"name":"RnJvbS1Nb2R1bGU","value":"Y2JuMEtLckJaSDdoZE5rTm9rdVhMdEdyeXJXTS0tUGpTVEJxSXp3OUtraw"},
        {"name":"UHVzaGVkLUZvcg","value":"b1c5d1U1LW9SMHgxbXNPRVJEY0NPQ2U1MkZrV3RSNUFOU2J3dEZGQS1Fcw"}
      ],"target":"ZjmB2vEUlHlJ7-rgJkYP09N5IzLPhJyStVrK5u9dDEo"
    },"event":"ans104-data-item-indexed","level":"info","message":"Received webhook:","timestamp":"2024-09-23T19:28:35.449Z"}


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

  it('should store a')
});
