console.debug('initializing');

import * as utils from '../utils.js';

onmessage = async ({ data, origin, source }) => {
  let { call, args, txid } = data;
  let resp = { txid };

  try {
    let fn = utils[call];

    if (typeof fn != 'function')
      throw new TypeError('Invalid call: ' + call);
    if (!Array.isArray(args))
      throw new TypeError('Invalid args: ' + typeof args);

    console.debug('Invoking:', call);
    resp.res = await fn(...args);
  } catch (e) {
    console.error(e);
    resp.err = e;
  }

  postMessage(resp);
};

postMessage({ status: 'ready' });
console.debug('ready');
