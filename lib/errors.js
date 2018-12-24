'use strict';

var createError = require('errno').create;

var BitcoreNodeError = createError('BellcoreNodeError');

var RPCError = createError('RPCError', BitcoreNodeError);

module.exports = {
  Error: BitcoreNodeError,
  RPCError: RPCError
};
