'use strict';

var should = require('chai').should();

describe('Index Exports', function() {
  it('will export bellcore-lib', function() {
    var bellcore = require('../');
    should.exist(bellcore.lib);
    should.exist(bellcore.lib.Transaction);
    should.exist(bellcore.lib.Block);
  });
});
