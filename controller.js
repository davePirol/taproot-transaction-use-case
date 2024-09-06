const bitcoin = require('bitcoinjs-lib');
const tinysecp = require('tiny-secp256k1');
const ECPairFactory = require('ecpair').ECPairFactory;
const ECPair = ECPairFactory(tinysecp);
const { BIP32Factory } = require('bip32');
const bip32 = BIP32Factory(tinysecp);
const BitcoinCoreClient = require('./BitcoinCoreClient.js')
const { MerkleTree } = require('merkletreejs');
const { witnessStackToScriptWitness } = require("./witness_stack_to_script_witness");

bitcoin.initEccLib(tinysecp);

class Controller{

  
  network = bitcoin.networks.regtest;
  hashes;

  priceForUser;
  priceForMerchant;
  fee;

  core;
  merkleTree;
  scriptTree;

  userKeyPair;
  issuerKeyPair;
  merchantKeyPair;

  constructor(){
    this.core=new BitcoinCoreClient();
    this.merkleTree=[];
    this.hashes=[
      '5ac1e98bd96888758a72135240684568b0d1d4350a5d3d87736b807a838dd193',
      'acb25d781d0fae9fe90e17c16348a87ca2dbd39f4fc988965a138468dab7b787',
      '418de2ceac5129a866b6c3dd67ad1537102951e0bfe77398b37bfae092b84119'
    ];
    this.priceForUser=0.01
    this.priceForMerchant=0.008
    this.fee=0.0001
  }


  toXOnly(pubkey){
      return pubkey.subarray(1, 33)
  }

  async loadWallet(){
    try{
      await this.core.loadWallet('testwallet1');
    } catch (error) {
      console.error('Error in loading wallet: ', error);
    }       
  }   

  async mineBlock(){
    try{
      await this.core.mineblocks(1);
    } catch (error) {
      console.error('Error in mining transaction details: ', error);
    } 
    
  }

  async getRawTransaction(client, txID){
    try{
      const info = await client.getRawTransaction(txID);
      return info
    } catch (error) {
      console.error('Error in retrieving transaction details: ', error);
    } 
  } 

  async rechargeUserAddress(){
    this.userKeyPair = ECPair.makeRandom({network: this.network});
    const { address } = bitcoin.payments.p2pkh({ 
      pubkey: this.userKeyPair.publicKey,
      network: this.network 
    });

    const txID = await this.core.makeTransaction(address, 0.02);
    return txID;

  }

  createAddress() {
    const keyPair = ECPair.makeRandom();  
    const { address } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey });

    return { address, keyPair };
  }

  createTaprootTree(scripts){
    if(scripts.length==0){
      return;
    }
    if(scripts.length==1){
      return {output: scripts[0], redeemVersion: 192};
    }else if(scripts.length==2){
      return [{output: scripts[0], redeemVersion: 192}, {output: scripts[1], redeemVersion: 192}]
    }else{

      let left=scripts.splice(0, scripts.length/2)
      let toInsertLeft=left[0];
      let toInsertRight=scripts[0];
      left.shift();
      scripts.shift();
      let newTreeLeft=[this.createTaprootTree(left), {output: toInsertLeft, redeemVersion: 192}];
      let newTreeRight=[this.createTaprootTree(scripts), {output: toInsertRight, redeemVersion: 192}];
      return [newTreeLeft, newTreeRight];
    }
  }

  async createTransaction(transactionID, senderKeyPair, amountInUTXO, amountToSend) {
    try{
      
      let info = await this.getRawTransaction(this.core, transactionID);
      let index, value;

      this.issuerKeyPair = ECPair.makeRandom({network: this.network});  
      let toAddress  =  bitcoin.payments.p2pkh({ 
        pubkey: this.issuerKeyPair.publicKey,
        network: this.network 
      }).address;

      let keyPair = ECPair.makeRandom({network: this.network});
      const changeAddress = bitcoin.payments.p2pkh({ 
        pubkey: keyPair.publicKey,
        network: this.network 
      }).address;


      for(var i= 0; i<info.vout.length; i++){
        if(info.vout[i].value==amountInUTXO){
          index = info.vout[i].n;
          value = info.vout[i].value;
        }
      } 
      const psbt = new bitcoin.Psbt({network:this.network});
      psbt.addInput({
        hash: transactionID,
        index: index,
        nonWitnessUtxo: Buffer.from(info.hex, 'hex'),
      });
      psbt.addOutput({
        address: toAddress,
        value: Math.round((amountToSend) * Math.pow(10, 8)),
      });
      psbt.addOutput({
        address: changeAddress,
        value: Math.round((value-amountToSend-this.fee) * Math.pow(10, 8)),
      });
      psbt.signInput(0, senderKeyPair);
      psbt.finalizeAllInputs();
      const rawTx = psbt.extractTransaction().toHex();
      const txID = await this.core.broadcastTransaction(rawTx);

      return txID;

    }catch (error) {
      console.error('Error creating transaction:', error);
    }
  }

  async setUpIssuerTransaction(prevTransactionID, senderKeyPair){
    try {    

      const internalKeyPair = ECPair.makeRandom({ network: this.network });
      const internalPubkey = internalKeyPair.publicKey.slice(1);
      let scripts=[];
      let scriptsInClear=[];

      const preimages=[
        '7c54a03433356add698847ef9b821573eacb6a7c8b8067536f16d6013b06097a',
        'cf479b769e607583b34ed0efaaf426c457309cd59ab6418d692d1becf451a4b1',
        '00b892a92c7425f4d4316c1e228ce0c7ecbcfed11612b34eeebeb123e5a829cf'
      ];

      for (var i = 0; i < this.hashes.length; i++) {
        let set = ECPair.makeRandom({network: this.network});
        if(i==0){
          this.merchantKeyPair = set;
        }
        let leafScriptAsm = `OP_SHA256 ${this.hashes[i]} OP_EQUALVERIFY ${this.toXOnly(set.publicKey).toString('hex')} OP_CHECKSIG`;
        let leafScript = bitcoin.script.fromASM(leafScriptAsm);
        scripts.push(leafScript);
        scriptsInClear.push(leafScriptAsm);
      }

      const setUser = ECPair.makeRandom({network: this.network});
      let leafScriptAsm = `OP_PUSHDATA1 90 OP_CHECKLOCKTIMEVERIFY OP_DROP ${this.toXOnly(setUser.publicKey).toString('hex')} OP_CHECKSIG`;
      let leafScript = bitcoin.script.fromASM(leafScriptAsm);
      scripts.push(leafScript);
      scriptsInClear.push(leafScriptAsm);
      const scriptHashes = scripts.map(x => bitcoin.crypto.sha256(x))
      
      this.merkleTree = new MerkleTree(scriptHashes, bitcoin.crypto.sha256);
      this.scriptTree = this.createTaprootTree(scripts);
      const root = this.merkleTree.getRoot().toString('hex');
      
      const p2tr = bitcoin.payments.p2tr({
          internalPubkey: internalPubkey,
          scriptTree: this.scriptTree,
          network: this.network,
      });

      const info = await this.getRawTransaction(this.core, prevTransactionID);
      let index, value;

      for(var i = 0; i < info.vout.length; i++){
        if(info.vout[i].value == this.priceForUser){
          index = info.vout[i].n;
          value = info.vout[i].value;
        }
      } 

      let keyPair = ECPair.makeRandom({network: this.network});
      const changeAddress = bitcoin.payments.p2pkh({ 
        pubkey: keyPair.publicKey,
        network: this.network 
      }).address;

      const destinationAddress = p2tr.address; 

      const psbt = new bitcoin.Psbt({network:this.network});
      psbt.addInput({
        hash: info.hash,
        index: index,
        nonWitnessUtxo: Buffer.from(info.hex, 'hex'),
      });
      psbt.addOutput({
        address: destinationAddress,
        value: Math.round((this.priceForMerchant) * Math.pow(10, 8)),
      });
      psbt.addOutput({
        address: changeAddress,
        value: Math.round((value-this.priceForMerchant-this.fee) * Math.pow(10, 8)),
      });
      psbt.signInput(0, senderKeyPair);
      psbt.finalizeAllInputs();
      const rawTx = psbt.extractTransaction().toHex();
      const txID = await this.core.broadcastTransaction(rawTx);

      return {
        'txID':txID,
        'internalPublicKey': internalPubkey.toString('hex'),
        'scripts': scriptsInClear,
        'rootTree': root,
        'preimages': preimages
      };
          
      } catch (error) {
          console.error('Error in set up taproot transaction: ', error);
      }
  }


  async redeemTransaction(transactionToRedeemID, senderKeyPair, internalPublickey, scriptString, preimage, proofPath){
    try{
      let info = await this.getRawTransaction(this.core, transactionToRedeemID);
      let vout, amount, scriptHex; 

      for(let i=0; i<info.vout.length; i++){
        if(info.vout[i].value==this.priceForMerchant){
          vout=info.vout[i].n;
          amount=info.vout[i].value;
          scriptHex=info.vout[i].scriptPubKey.hex;
        }
      } 
      const internalPubkey = Buffer.from(internalPublickey, 'hex');
    
      const hash_lock_redeem = {
          output: bitcoin.script.fromASM(scriptString),
          redeemVersion: 192,
      };
      const hash_lock_p2tr = bitcoin.payments.p2tr({
          internalPubkey: internalPubkey,
          scriptTree: this.scriptTree,
          redeem: hash_lock_redeem,
          network:this.network
      });
      const tapLeafScript = {
          leafVersion: hash_lock_redeem.redeemVersion,
          script: hash_lock_redeem.output,
          controlBlock: hash_lock_p2tr.witness[hash_lock_p2tr.witness.length - 1]
      };

      const psbt = new bitcoin.Psbt({ network: this.network });
      psbt.addInput({
        hash: transactionToRedeemID,
        index: vout,
        witnessUtxo: {
          script: hash_lock_p2tr.output, 
          value: Math.round(amount *  Math.pow(10, 8))
        },
        tapLeafScript: [
          tapLeafScript
        ]
      });
      

      //TEST
      /*
      const proofPathData = proofPath.map(item => item.data);
      proofPathData.reverse();
      console.log(proofPathData)
      const controlBlock = Buffer.concat([
        Buffer.from([0xc0]), 
        Buffer.from(internalPublickey, 'hex'), 
        ...proofPathData
      ]);
      const leafScript = bitcoin.script.fromASM(scriptString);
      
      const tapLeafScript = {
        controlBlock: Buffer.from(controlBlock),
        leafVersion: 0xc0,
        script: leafScript
      }

      const psbt = new bitcoin.Psbt({ network: bitcoin.networks.regtest });
      psbt.addInput({
        hash: transactionToRedeemID,
        index: vout,
        witnessUtxo: {
          script: Buffer.from(scriptHex, 'hex'), 
          value: amount * Math.pow(10, 8)
        },
        tapLeafScript: [
          tapLeafScript
        ]
      });
      */
      //TEST

      let keyPair = ECPair.makeRandom({network: this.network});
      const newMerchantAddress = bitcoin.payments.p2pkh({ 
        pubkey: keyPair.publicKey,
        network: this.network 
      }).address;

    
      psbt.addOutput({
        address: newMerchantAddress,
        value: Math.round((this.priceForMerchant - this.fee) * Math.pow(10, 8)), 
      });

      psbt.signInput(0, senderKeyPair);

      const customFinalizer = (_inputIndex, input) => {
        const scriptSolution = [
            input.tapScriptSig[0].signature,
            Buffer.from(preimage, 'hex')
        ];
        const witness = scriptSolution
            .concat(tapLeafScript.script)
            .concat(tapLeafScript.controlBlock);

        return {
            finalScriptWitness: witnessStackToScriptWitness(witness)
        }
      }

      psbt.finalizeInput(0, customFinalizer);
      const rawTx = psbt.extractTransaction().toHex();
      const txID = await this.core.broadcastTransaction(rawTx);
      return txID;

    }catch(error){
      console.error('Error in redeeming transaction: ', error);
    }
  }



  /*test(){
    const controlBlockHex = 'c097ec9221c5f5e70aaf566f159af5841fbf0f8e7f0675904ac256cc6b3d754091a915ff9981956f7e1701a6170257054343593abd7f7122645d33e09c232f44a505273b378c760bce1b2a63031b7aba9f0b0ae2f2fd29b9884c72789f9233d338';
    const controlBlockBuffer = Buffer.from(controlBlockHex, 'hex');

    // Extract components
    const versionByte = controlBlockBuffer[0];
    const internalPublicKey = controlBlockBuffer.slice(1, 34).toString('hex');
    const proofPath = controlBlockBuffer.slice(32).toString('hex'); // You might need to split this into individual proof path hashes

    console.log('Version Byte:', versionByte.toString(16));
    console.log('Internal Public Key:', internalPublicKey);
    console.log('Proof Path:', proofPath);
  }

  test2(){
    const scriptHex = 'a8205ac1e98bd96888758a72135240684568b0d1d4350a5d3d87736b807a838dd1938821039b7dc6ef21638fc419251f02ecc90c7af32425600c92de83bdb4b36c64285e41ac';
    const scriptBuffer = Buffer.from(scriptHex, 'hex');
    const scriptum = bitcoin.script.decompile(scriptBuffer);

    console.log('Decoded Script:', scriptum);
  }*/

  async main() {
      try {
          const startTX = await this.rechargeUserAddress();
          await core.mineblocks(1);
          const transactionID = await this.createTransaction(startTX, userKeyPair, 0.02, priceForUser);
          await core.mineblocks(1);
          const taprootTransaction = await this.setUpIssuerTransaction(transactionID, issuerKeyPair);
          await core.mineblocks(1);

          const proof = merkleTree.getProof(bitcoin.crypto.sha256(bitcoin.script.fromASM(taprootTransaction.scripts[0])));
          
          const res = await this.redeemTransaction(
              taprootTransaction.txID,
              merchantKeyPair, 
              taprootTransaction.internalPublicKey,
              taprootTransaction.scripts[0], 
              taprootTransaction.preimages[0],
              proof
          );
          console.log(res);

      } catch (error) {
          console.error('Error processing transaction:', error);
      }
  }
}
module.exports = Controller