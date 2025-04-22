import { ARIO } from '@ar.io/sdk';
import { connect } from '@permaweb/aoconnect';
import * as config from '../config.js';

export const ario = ARIO.mainnet();
export const ao = connect({
  CU_URL: config.cuUrl,
  MODE: 'legacy',
});
