const Client = require('bitcoin-core');

class BitcoinCoreClient{

    client;

    constructor(walletName){
        this.client=new Client({
            network: 'regtest',
            version: '0.27.1',
            username: 'first-node',
            password: '603a2f3c94eb961044154211f7667cf9$4fb5ee17bbc9c7579d125ee2e46653ab3b304b7a81028d5b253ceb27405e079c',
            host: '127.0.0.1',
            port: 18443,
            headers: false,
            wallet: walletName
        });

    }

    async loadWallet(name){
        const loadedWallets = await this.client.command('listwallets');
        if (loadedWallets.includes(name)) {
          return true;
        }
        let res=await this.client.loadWallet(name);
        console.log(res);
        return true;
    }

    async mineblocks(nBlocks) {
        let toAddress=await this.client.getNewAddress()   
        let transactionIDs=this.client.generateToAddress({
            nblocks:nBlocks,
            address: toAddress
        })//.then(()=>console.log('mined into '+toAddress+' '+nBlocks+' blocks'));
        return transactionIDs;
    }

    async getNewAddress(){
        return await this.client.getNewAddress();
    }

    async makeTransaction(receipitAddress, amount){

        let transactionHEX=await this.client.sendToAddress({
            address:receipitAddress,
            amount: amount
        });

        return transactionHEX;
    }

    async getUTXOList(minConfirmations = 1, maxConfirmations = 9999999) {
        
        const utxos = await this.client.command('listunspent', minConfirmations, maxConfirmations);
        console.log('UTXOs:', utxos);
        return utxos;
    }

    async getPubKeyFromAddress(address){
        const info = await this.client.getAddressInfo(address);
        return info.pubkey
    }

    async getPrivKeyFromAddress(address){
        const privkey = await this.client.dumpPrivKey(address);
        return privkey
    }

    async getRawTransaction(transactionID){
        const info = await this.client.getRawTransaction({
            txid: transactionID,
            verbosity: 1
        });
        return info;
    }

    async signTransaction(transactionHEX){
        const result = await this.client.signRawTransactionWithWallet({
            hexstring:transactionHEX
        });
        return result;
    }

    async broadcastTransaction(transactionHEX){
        const txID = await this.client.command('sendrawtransaction', transactionHEX);
        return txID;
    }

    async processPSBT(psbt_base64){
        const res = await this.client.walletProcessPsbt(psbt_base64);
        return res;
    }
    async finalizePsbt(psbt_hex){
        const res = await this.client.finalizePsbt(psbt_hex);
        return res;
    }
    async decodePsbt(psbt_base64){
        const res = await this.client.decodePsbt(psbt_base64);
        return res;
    }
}
module.exports = BitcoinCoreClient 
