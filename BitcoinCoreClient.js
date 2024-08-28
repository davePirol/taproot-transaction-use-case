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

    async mineblocks(nBlocks) {
        let toAddress=await this.client.getNewAddress()   
        //console.log(toAddress);
        let transactionIDs=this.client.generateToAddress({
            nblocks:2,
            address: toAddress
        }).then(()=>console.log('mined into '+toAddress+' '+nBlocks+' blocks'));
        return transactionIDs;
    }

    async getNewAddress(){
        return await this.client.getNewAddress();
    }

    async makeTransaction(receipitAddress, amount){

        let transactionHEX=this.client.sendToAddress({
            address:receipitAddress,
            amount: amount
        }).then((result)=>console.log(result))

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

    async getRawTransaction(transactionID){
        const info = await this.client.getRawTransaction(transactionID);
        return info;
    }
}
module.exports = BitcoinCoreClient 
