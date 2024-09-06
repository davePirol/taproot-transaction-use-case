This is a thesis project based on Bitcoin transactions.
Here Taproot transactions are used as purchase of a set of goods, product or service.
Every Taproot transaction contains a Taproot tree with some scripts. Each one represents a specific either product, service, or good.
Each script is an hash lock contract with a specific public key of a merchant and an hash of a secret word.
To redeem a transaction a merchant have to sign the correspondent leaf and provide the secret word.

## Usage
To use the project install the realtive dependencies through npm and then start Bitcoincore in regtest mode.
Once the network is started you can start with command 
```
node index.js
```
