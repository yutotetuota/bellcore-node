# Fee Service

The fee service is a requirement of the insight-api service (not a bellcore-node built-in service). Its primary purpose is to query a bellcoin full node for the most up-to-date miner fees for transactions. A bellcoin full node such as [bellcoind](https://github.com/bellcoin-org/bellcoin) or [bcoin](https://github.com/yutotetuota/bcoin) with an available RPC interface is required.

## Service Configuration

```json
"fee": {
  "rpc": {
    "user": "user",
      "pass": "pass",
      "host": "localhost",
      "protocol": "http",
      "port": 8332
  }
}
```
## Usage Example

```bash
curl http://localhost:3001/insight-api/estimateFee
```
