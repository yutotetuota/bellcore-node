'use strict';

var BaseService = require('../../service');
var inherits = require('util').inherits;
var async = require('async');
var index = require('../../');
var log = index.log;
var bitcore = require('bellcore-lib');
var Unit = bitcore.Unit;
var _ = bitcore.deps._;
var lodash = require('lodash');
var Encoding = require('./encoding');
var Transform = require('stream').Transform;
var assert = require('assert');
var utils = require('../../utils');

var AddressService = function(options) {

  BaseService.call(this, options);
  this._header = this.node.services.header;
  this._block = this.node.services.block;
  this._timestamp = this.node.services.timestamp;
  this._transaction = this.node.services.transaction;
  this._network = this.node.network;
  this._db = this.node.services.db;
  this._mempool = this.node.services.mempool;

  if (this._network === 'livenet') {
    this._network = 'main';
  }
  if (this._network === 'regtest') {
    this._network = 'testnet';
  }

};

inherits(AddressService, BaseService);

AddressService.dependencies = [
  'db',
  'block',
  'header',
  'transaction',
  'timestamp',
  'mempool'
];

// this must return the to-from number of txs for ALL passed in addresses sort from latest txs to earliest
// for example if the query /api/addrs/txs?from=0&to=5&noAsm=1&noScriptSig=1&noSpent=1, and the addresses passed
// in are [addr1, addr2, addr3], then if addr3 has tx1 at height 10, addr2 has tx2 at height 9 and tx1 has no txs,
// then I would pass back [tx1, tx2] in that order
AddressService.prototype.getAddressHistory = function(addresses, options, callback) {
  var self = this;

  options = options || {};
  options.from = options.from || 0;
  options.to = options.to || 0xffffffff;
  options.txIdList = [];

  if (_.isUndefined(options.queryMempool)) {
    options.queryMempool = true;
  }

  if (_.isString(addresses)) {
    addresses = [addresses];
  }
  async.eachLimit(addresses, 20, function(address, next) {
    self._getAddressTxSummary(address, options, function(err, results) {
      if (results) {
        options.txIdList = options.txIdList.concat(results);
      }
      next(err);
    });
  }, function(err) {

    if(err) {
      return callback(err);
    }

    var unique = {};
    var list = [];

    for (let i = 0; i < options.txIdList.length; i++) {
      unique[options.txIdList[i].txid + options.txIdList[i].height] = options.txIdList[i];
    }

    for (var prop in unique) {
      list.push(unique[prop]);
    }

    options.txIdList = list.sort(function(a, b) {
     return b.height - a.height;
    });

    self._getAddressTxHistory(options, function(err, txList) {

      if (err) {
        return callback(err);
      }

      var results = {
        totalCount: options.txIdList.length || 0,
        items: txList
      };

      callback(null, results);

    });
  });

};

// this is basically the same as _getAddressHistory apart from the summary
AddressService.prototype.getAddressSummary = function(address, options, callback) {

  var self = this;

  options = options || {};
  options.from = options.from || 0;
  options.to = options.to || 0xffffffff;

  if (_.isUndefined(options.queryMempool)) {
    options.queryMempool = true;
  }

  var result = {
    addrStr: address,
    balance: 0,
    balanceSat: 0,
    totalReceived: 0,
    totalReceivedSat: 0,
    totalSent: 0,
    totalSentSat: 0,
    unconfirmedBalance: 0,
    unconfirmedBalanceSat: 0,
    unconfirmedTxApperances: 0,
    txApperances: 0,
  };
  if (!options.noTxList) {
    result.transactions = [];
  }

  return self._getAddressTxSummary(address, options, function(err, txList) {
    if (err || !txList) {
      return callback(err);
    }

    var unique = {};
    var tipHeight = self._block.getTip().height;
    for (let i = 0; i < txList.length; i++) {
      const tx = txList[i];
      const isConfirmed = tx.height && tx.height <= tipHeight;
      if (tx.input) {
        result.balanceSat -= tx.satoshis;
        result.totalSentSat += tx.satoshis;
        if (!isConfirmed) {
          result.unconfirmedBalanceSat -= tx.satoshis;
        }
      } else {
        result.balanceSat += tx.satoshis;
        result.totalReceivedSat += tx.satoshis;
        if (!isConfirmed) {
          result.unconfirmedBalanceSat += tx.satoshis;
        }
      }

      if (!unique[tx.txid]) {
        unique[tx.txid] = true;
        result.txApperances++;
        if (!isConfirmed) {
          result.unconfirmedTxApperances++;
        }
        if (!options.noTxList) {
          result.transactions.push(tx.txid);
        }
      }
    }
    result.balance = Unit.fromSatoshis(result.balanceSat).toBTC();
    result.totalReceived = Unit.fromSatoshis(result.totalReceivedSat).toBTC();
    result.totalSent = Unit.fromSatoshis(result.totalSentSat).toBTC();
    result.unconfirmedBalance = Unit.fromSatoshis(result.unconfirmedBalanceSat).toBTC();
    callback(null, result);
  });

};

AddressService.prototype.getAddressUnspentOutputs = function(address, options, callback) {

  var self = this;

  options = options || {};
  options.from = options.from || 0;
  options.to = options.to || 0xffffffff;

  if (_.isUndefined(options.queryMempool)) {
    options.queryMempool = true;
  }

  var results = [];

  var start = self._encoding.encodeUtxoIndexKey(address);
  var final = new Buffer(new Array(73).join('f'), 'hex');
  var end = Buffer.concat([ start.slice(0, -36), final ]);

  var criteria = {
    gte: start,
    lt: end
  };

  async.waterfall([

    // query the mempool if necessary
    function(next) {

      if (!options.queryMempool) {
        return next(null, []);
      }

      self._mempool.getTxidsByAddress(address, 'output', next);
    },

    // if mempool utxos, then add them first
    function(mempoolTxids, next) {

      if (mempoolTxids.length <= 0) {
        return next();
      }

      return async.eachLimit(mempoolTxids, 20, function(id, next) {

        self._mempool.getMempoolTransaction(id.txid, function(err, tx) {

          if (err || !tx) {
            return next(err || new Error('Address Service: missing tx: ' + id.txid));
          }

          results = results.concat(self._getMempoolUtxos(tx, address));
          next();

        });

      }, next);
    },

    function(next) {

      var utxoStream = self._db.createReadStream(criteria);
      var streamErr;

      utxoStream.on('end', function() {

        if (streamErr) {
          return callback(streamErr);
        }

        results = utils.orderByConfirmations(results);
        next(null, results);

      });

      utxoStream.on('error', function(err) {
        streamErr = err;
      });

      utxoStream.on('data', function(data) {

        var key = self._encoding.decodeUtxoIndexKey(data.key);
        var value =  self._encoding.decodeUtxoIndexValue(data.value);

        results.push({
          address: address,
          txid: key.txid,
          vout: key.outputIndex,
          ts: value.timestamp,
          scriptPubKey: value.script.toString('hex'),
          amount: Unit.fromSatoshis(value.satoshis).toBTC(),
          height: value.height,
          satoshis: value.satoshis,
          confirmations: self._block.getTip().height - value.height + 1
        });

      });
    }
  ], callback);

};

AddressService.prototype._getMempoolUtxos = function(tx, address) {

  var results = [];

  for(var i = 0; i < tx.outputs.length; i++) {

    var output = tx.outputs[i];

    if (utils.getAddress(output, this._network) !== address) {
      continue;
    }

    results.push({
      address: address,
      txid: tx.txid(),
      vout: i,
      scriptPubKey: output.script.toRaw().toString('hex'),
      amount: Unit.fromSatoshis(output.value).toBTC(),
      height: null,
      satoshis: output.value,
      confirmations: 0
    });
  }

  return results;
};

AddressService.prototype.getAPIMethods = function() {
  return [
    ['getAddressHistory', this, this.getAddressHistory, 2],
    ['getAddressSummary', this, this.getAddressSummary, 1],
    ['getAddressUnspentOutputs', this, this.getAddressUnspentOutputs, 1]
  ];
};

AddressService.prototype.start = function(callback) {

  var self = this;

  this._db.getPrefix(this.name, function(err, prefix) {
    if(err) {
      return callback(err);
    }
    self._encoding = new Encoding(prefix);
    callback();
  });
};

AddressService.prototype.stop = function(callback) {
  setImmediate(callback);
};

AddressService.prototype._getTxStream = function(address, options) {

  var start = this._encoding.encodeAddressIndexKey(address);
  var end = Buffer.concat([
    start.slice(0, address.length + 4),
    options.endHeightBuf,
    new Buffer(new Array(83).join('f'), 'hex')
  ]);

  var criteria = {
    gte: start,
    lte: end,
    reverse: true // txids stream from low confirmations to high confirmations
  };

  // txid stream
  var txidStream = this._db.createReadStream(criteria);

  txidStream.on('close', function() {
    txidStream.unpipe();
  });

  return txidStream;
};

AddressService.prototype._getAddressTxHistory = function(options, callback) {

  var self = this;

  // slice the txids based on pagination needs
  var ids = options.txIdList.slice(options.from, options.to);

  // go and get the actual txs
  async.mapLimit(ids, 20, function(id, next) {

    if (id.height === 0xffffffff) {
      return self._mempool.getMempoolTransaction(id.txid, function(err, tx) {

        if (err || !tx) {
          return next(err || new Error('Address Service: could not find tx: ' + id.txid));
        }

        self._transaction.setTxMetaInfo(tx, options, next);

      });
    }

    self._transaction.getDetailedTransaction(id.txid, options, next);

  }, callback);

};

AddressService.prototype._getAddressTxSummary = function(address, options, callback) {
  var self = this;

  options = options || {};
  options.start = options.start || 0;
  options.end = options.end || 0xffffffff;

  var results = [];

  options.endHeightBuf = new Buffer(4);
  options.endHeightBuf.writeUInt32BE(options.end);

  if (_.isUndefined(options.queryMempool)) {
    options.queryMempool = true;
  }

  async.waterfall([

    // query the mempool for relevant txs for this address
    function(next) {

      if (!options.queryMempool) {
        return next(null, []);
      }

      self._mempool.getTxidsByAddress(address, 'both', next);
    },

    // add the meta data such as input values, etc.
    function(mempoolTxids, next) {

      if (mempoolTxids.length <= 0) {
        return next();
      }

      async.eachLimit(mempoolTxids, 20, function(id, next) {

        self._mempool.getMempoolTransaction(id.txid, function(err, tx) {
          if (err || !tx) {
            return next(err || new Error('Address Service: missing tx: ' + id.txid));
          }

          self._transaction.setTxMetaInfo(tx, options, function(err, tx) {
            if (err || !tx) {
              return next(err);
            }
            results = results.concat(self._getMempoolUtxs(tx, address));
            next();
          });
        });
      }, next);
    },
    // stream the rest of the confirmed txids out of the address index
    function(next) {

      var txIdTransformStream = new Transform({ objectMode: true });

      txIdTransformStream._flush = function(callback) {
        txIdTransformStream.emit('end');
        callback();
      };

      txIdTransformStream.on('error', function(err) {
        log.error('Address Service: txstream err: ' + err);
        txIdTransformStream.unpipe();
      });

      txIdTransformStream.on('end', function() {
        next();
      });

      txIdTransformStream._transform = function(chunk, enc, callback) {
        var key = self._encoding.decodeAddressIndexKey(chunk.key);
        var value = self._encoding.decodeAddressIndexValue(chunk.value);

        results.push({
          txid: key.txid,
          height: key.height,
          input: key.input,
          satoshis: value
        });
        callback();
      };

      var txidStream = self._getTxStream(address, options);
      txidStream.pipe(txIdTransformStream);

    }
  ], function(err) {
    callback(err, results);
  });
};

AddressService.prototype._getMempoolUtxs = function(tx, address) {
  var results = [];

  for(var i = 0; i < tx.inputs.length; i++) {
    var input = tx.inputs[i];
    if (utils.getAddress(input, this._network) !== address) {
      continue;
    }

    results.push({
      txid: tx.txid(),
      height: null,
      satoshis: tx.__inputValues[i],
      input: 1
    });
  }

  for(var i = 0; i < tx.outputs.length; i++) {
    var output = tx.outputs[i];
    if (utils.getAddress(output, this._network) !== address) {
      continue;
    }

    results.push({
      txid: tx.txid(),
      satoshis: output.value,
      height: null,
      input: 0,
    });
  }

  return results;
};

AddressService.prototype._removeBlock = function(block, callback) {

  var self = this;

  async.mapSeries(block.txs, function(tx, next) {

    self._removeTx(tx, block, next);

  }, callback);

};

AddressService.prototype._removeTx = function(tx, block, callback) {

  var self = this;
  var operations = [];

  async.parallelLimit([

    function(next) {
      async.eachOfSeries(tx.inputs, function(input, indext, next) {
        self._removeInput(input, tx, block, index, function(err, ops) {
          if(err) {
            return next(err);
          }
          operations = operations.concat(ops);
          next();
        });
      }, next);
    },

    function(next) {
      async.eachOfSeries(tx.outputs, function(output, index, next) {
        self._removeOutput(output, tx, block, index, function(err, ops) {
          if(err) {
            return next(err);
          }
          operations = operations.concat(ops);
          next();
        });
      }, next);
    }

  ], 20, function(err) {

    if(err) {
      return callback(err);
    }

    callback(null, operations);

  });

};

AddressService.prototype._removeInput = function(input, tx, block, index, callback) {

  var self = this;
  var address = input.getAddress();

  var removalOps = [];

  if (!address) {
    return callback();
  }

  address.network = self._network;
  address = address.toString();

  assert(block && block.__ts && block.__height, 'Missing block or block values.');

  removalOps.push({
    type: 'del',
    key: self._encoding.encodeAddressIndexKey(address, block.__height, tx.txid(), index, 1, block.__ts)
  });

  // look up prev output of this input and put it back in the set of utxos
  self._transaction.getTransaction(input.prevout.txid(), function(err, _tx) {

    if (err) {
      return callback(err);
    }

    assert(_tx, 'Missing prev tx to insert back into the utxo set when reorging address index.');
    assert(_tx.__height && _tx.__inputValues && _tx.__timestamp, 'Missing tx values.');

    removalOps.push({
      type: 'put',
      key: self._encoding.encodeUtxoIndexKey(address, _tx.txid(), input.prevout.index),
      value: self._encoding.encodeUtxoIndexValue(
        _tx.__height,
        _tx.__inputValues[input.prevout.index],
        _tx.__timestamp, _tx.outputs[input.prevout.index].script.toRaw())
    });

    callback(null, removalOps);

  });
};

AddressService.prototype._removeOutput = function(output, tx, block, index, callback) {

  var self = this;
  var address = output.getAddress();
  var removalOps = [];

  if (!address) {
    return callback();
  }

  address.network = self._network;
  address = address.toString();

  assert(block && block.__ts && block.__height, 'Missing block or block values.');

  removalOps.push({
    type: 'del',
    key: self._encoding.encodeAddressIndexKey(address, block.__height, tx.txid(), index, 0, block.__ts)
  });

  //remove the utxo for this output from the collection
  removalOps.push({
    type: 'del',
    key: self._encoding.encodeUtxoIndexKey(address, tx.txid(), index)
  });

  setImmediate(function() {
    callback(null, removalOps);
  });
};

AddressService.prototype.onReorg = function(args, callback) {

  var self = this;

  var oldBlockList = args[1];

  // for every tx, remove the address index key for every input and output
  // for every input record, we need to find its previous output and put it back into the utxo collection
  async.mapSeries(oldBlockList, self._removeBlock.bind(self), function(err, ops) {

    if (err) {
      return callback(err);
    }

   var operations = lodash.compact(lodash.flattenDeep(ops));
    callback(null, operations);
  });

};

AddressService.prototype.onBlock = function(block, callback) {
  var self = this;

  if (self.node.stopping) {
    return callback();
  }

  var operations = [];

  for(var i = 0; i < block.txs.length; i++) {
    var tx = block.txs[i];
    var ops = self._processTransaction(tx, { block: block });
    operations.push(ops);
  }

  operations = lodash.flattenDeep(operations);

  callback(null, operations);
};

AddressService.prototype._processInput = function(tx, input, index, opts) {

  var address = input.getAddress();

  if(!address) {
    return;
  }

  address.network = this._network;
  address = address.toString();

  var txid = tx.txid();
  var timestamp = this._timestamp.getTimestampSync(opts.block.rhash());

  assert(timestamp, 'Must have a timestamp in order to process input.');

  // address index
  var operations = [{
    type: 'put',
    key: this._encoding.encodeAddressIndexKey(address, opts.block.__height, txid, index, 1, timestamp),
    value: this._encoding.encodeAddressIndexValue(tx.__inputValues[index])
  }];

  // prev utxo
  var rec = {
    type: 'del',
    key: this._encoding.encodeUtxoIndexKey(address, input.prevout.txid(), input.prevout.index)
  };

  operations.push(rec);

  return operations;
};

AddressService.prototype._processOutput = function(tx, output, index, opts) {

  // TODO: if the output is pay to public key, we are reporting this as p2pkh
  // this leads to the spending tx not being properly indexed. Txs that
  // spend p2pk outputs, will not have the public key as part of their input script sig
  var address = output.getAddress();

  if(!address) {
    return;
  }

  address.network = this._network;
  address = address.toString();

  var txid = tx.txid();
  var timestamp = this._timestamp.getTimestampSync(opts.block.rhash());

  assert(timestamp, 'Must have a timestamp in order to process output.');

  var addressKey = this._encoding.encodeAddressIndexKey(address, opts.block.__height, txid, index, 0, timestamp);
  var addressValue = this._encoding.encodeAddressIndexValue(output.value);

  var utxoKey = this._encoding.encodeUtxoIndexKey(address, txid, index);
  var utxoValue = this._encoding.encodeUtxoIndexValue(
    opts.block.__height,
    output.value,
    timestamp,
    output.script.toRaw()
  );

  var operations = [{
    type: 'put',
    key: addressKey,
    value: addressValue
  }];

  operations.push({
    type: 'put',
    key: utxoKey,
    value: utxoValue
  });

  return operations;

};

AddressService.prototype._processTransaction = function(tx, opts) {

  var self = this;

  var _opts = { block: opts.block };

  var outputOperations = tx.outputs.map(function(output, index) {
    return self._processOutput(tx, output, index, _opts);
  });

  outputOperations = lodash.compact(lodash.flattenDeep(outputOperations));
  assert(outputOperations.length % 2 === 0 &&
    outputOperations.length <= tx.outputs.length * 2,
    'Output operations count is not reflective of what should be possible.');

  var inputOperations = tx.inputs.map(function(input, index) {
    return self._processInput(tx, input, index, _opts);
  });

  inputOperations = lodash.compact(lodash.flattenDeep(inputOperations));

  assert(inputOperations.length % 2 === 0 &&
    inputOperations.length <= tx.inputs.length * 2,
    'Input operations count is not reflective of what should be possible.');

  outputOperations = outputOperations.concat(inputOperations);
  return outputOperations;

};

module.exports = AddressService;
