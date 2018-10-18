# Setting up Development Environment

## Install Node.js

Install Node.js by your favorite method, or use Node Version Manager by following directions at https://github.com/creationix/nvm

```bash
nvm install v4
```

## Fork and Download Repositories

To develop bellcore-node:

```bash
cd ~
git clone git@github.com:<yourusername>/bellcore-node.git
git clone git@github.com:<yourusername>/bellcore-lib.git
```

To develop bellcoin or to compile from source:

```bash
git clone git@github.com:<yourusername>/bellcoin.git
git fetch origin <branchname>:<branchname>
git checkout <branchname>
```
**Note**: See bellcoin documentation for building bellcoin on your platform.


## Install Development Dependencies

For Ubuntu:
```bash
sudo apt-get install libzmq3-dev
sudo apt-get install build-essential
```
**Note**: Make sure that libzmq-dev is not installed, it should be removed when installing libzmq3-dev.


For Mac OS X:
```bash
brew install zeromq
```

## Install and Symlink

```bash
cd bellcore-lib
npm install
cd ../bellcore-node
npm install
```
**Note**: If you get a message about not being able to download bellcoin distribution, you'll need to compile bellcoind from source, and setup your configuration to use that version.


We now will setup symlinks in `bellcore-node` *(repeat this for any other modules you're planning on developing)*:
```bash
cd node_modules
rm -rf bellcore-lib
ln -s ~/bellcore-lib
rm -rf bellcoind-rpc
ln -s ~/bellcoind-rpc
```

And if you're compiling or developing bellcoin:
```bash
cd ../bin
ln -sf ~/bellcoin/src/bellcoind
```

## Run Tests

If you do not already have mocha installed:
```bash
npm install mocha -g
```

To run all test suites:
```bash
cd bellcore-node
npm run regtest
npm run test
```

To run a specific unit test in watch mode:
```bash
mocha -w -R spec test/services/bellcoind.unit.js
```

To run a specific regtest:
```bash
mocha -R spec regtest/bellcoind.js
```

## Running a Development Node

To test running the node, you can setup a configuration that will specify development versions of all of the services:

```bash
cd ~
mkdir devnode
cd devnode
mkdir node_modules
touch bellcore-node.json
touch package.json
```

Edit `bellcore-node.json` with something similar to:
```json
{
  "network": "livenet",
  "port": 3001,
  "services": [
    "bellcoind",
    "web",
    "insight-api",
    "insight-ui",
    "<additional_service>"
  ],
  "servicesConfig": {
    "bellcoind": {
      "spawn": {
        "datadir": "/home/<youruser>/.bellcoin",
        "exec": "/home/<youruser>/bellcoin/src/bellcoind"
      }
    }
  }
}
```

**Note**: To install services [insight-api](https://github.com/yutotetuota/insight-api-bellcoin) and [insight-ui](https://github.com/bitpay/insight-ui-bellcoin) you'll need to clone the repositories locally.

Setup symlinks for all of the services and dependencies:

```bash
cd node_modules
ln -s ~/bellcore-lib
ln -s ~/bellcore-node
ln -s ~/insight-api-bellcoin
ln -s ~/insight-ui-bellcoin
```

Make sure that the `<datadir>/bellcoin.conf` has the necessary settings, for example:
```
server=1
whitelist=127.0.0.1
txindex=1
addressindex=1
timestampindex=1
spentindex=1
zmqpubrawtx=tcp://127.0.0.1:28332
zmqpubhashblock=tcp://127.0.0.1:28332
rpcallowip=127.0.0.1
rpcuser=bellcoin
rpcpassword=local321
```

From within the `devnode` directory with the configuration file, start the node:
```bash
../bellcore-node/bin/bellcore-node start
```