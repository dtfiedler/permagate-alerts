import { ARIO, AOProcess, ARIO_MAINNET_PROCESS_ID } from '@ar.io/sdk';
import { connect } from '@permaweb/aoconnect';
import * as config from '../config.js';

export const ao = connect({
  CU_URL: 'https://cu.ardrive.io',
  MODE: 'legacy',
});

export const ario = ARIO.init({
  process: new AOProcess({
    processId: config.arioProcessId || ARIO_MAINNET_PROCESS_ID,
    // @ts-ignore
    ao: ao,
  }),
});
