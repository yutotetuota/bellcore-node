'use strict';

var index = require('../../');
var log = index.log;
var bcoin = require('bcoin');

var Bcoin = function(options) {
  this._config = this._getConfig(options);
};

Bcoin.prototype.start = function(callback) {
  var self = this;
  self._bcoin = bcoin.fullnode(self._config);

  log.info('Starting Bcoin full node...');

  self._bcoin.open().then(function() {
    self._bcoin.connect().then(function() {
      log.info('Waiting for Bcoin to sync');
      self._bcoin.startSync();

      if (!self._bcoin.chain.synced) {
        // wait for bcoin to sync before allowing p2p service to try to connect
        self._bcoin.chain.once('full', callback);
      } else {
        // this will instruct the p2p service to start trying to connect to bcoin right away
        callback();
      }
    });
  });
};

Bcoin.prototype.stop = function(callback) {
  var self = this;
  self._bcoin.stopSync();
  self._bcoin.disconnect().then(function() {
    return self._bcoin.close();
  }).then(callback);
};

// --- privates

Bcoin.prototype._getConfig = function(options) {
  var config = {
    db: 'leveldb',
    checkpoints: true,
    network: options.network || 'main',
    listen: true,
    logConsole: true,
    logLevel: 'info',
    port: options.port,
    persistent: true,
    workers: true
  };
  if (options.prefix) {
    config.prefix = options.prefix;
  }
  return config;
};

module.exports = Bcoin;
