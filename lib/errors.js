'use strict';

var createError = require('errno').create;

var BellcoreNodeError = createError('BellcoreNodeError');

var RPCError = createError('RPCError', BellcoreNodeError);

module.exports = {
  Error: BellcoreNodeError,
  RPCError: RPCError
};
