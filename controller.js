const bitcoin = require('bitcoinjs-lib');
const tinysecp = require('tiny-secp256k1');
const ECPairFactory = require('ecpair').ECPairFactory;
const ECPair = ECPairFactory(tinysecp);
const { BIP32Factory } = require('bip32');
const bip32 = BIP32Factory(tinysecp);
const BitcoinCoreClient = require('./BitcoinCoreClient.js')
const { MerkleTree } = require('merkletreejs');
const { witnessStackToScriptWitness } = require("./witness_stack_to_script_witness");
const { uuidv7 } = require('uuidv7');

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
    /*this.hashes=[
      '5ac1e98bd96888758a72135240684568b0d1d4350a5d3d87736b807a838dd193',
      'acb25d781d0fae9fe90e17c16348a87ca2dbd39f4fc988965a138468dab7b787',
      '418de2ceac5129a866b6c3dd67ad1537102951e0bfe77398b37bfae092b84119'
    ];*/
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

  async getRawTransaction(txID){
    try{
      const info = await this.core.getRawTransaction(txID);
      return info;
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

  createTaprootTreeOLD(scripts){
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

  createTaprootTree(scripts) {
    
    if (scripts.length === 0) {
        return null;
    }
    
    if (scripts.length === 1) {
        return { output: scripts[0], redeemVersion: 192 }; // Return a Tapleaf
    }

    // Recursive case: Split the scripts into two halves
    const mid = Math.floor(scripts.length / 2);
    
    const leftTree = this.createTaprootTree(scripts.slice(0, mid));
    const rightTree = this.createTaprootTree(scripts.slice(mid));
    return [leftTree, rightTree]; // [Taptree | Tapleaf, Taptree | Tapleaf]
}

  async createTransaction(transactionID, senderKeyPair, amountInUTXO, amountToSend) {
    try{
      
      let info = await this.getRawTransaction(transactionID);
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

  async setUpIssuerTransaction(prevTransactionID, senderKeyPair, nScripts){
    try {    

      const internalKeyPair = ECPair.makeRandom({ network: this.network });
      const internalPubkey = internalKeyPair.publicKey.slice(1);
      let scripts=[];
      let scriptsInClear=[];
      let preimages=[];

      for(let i=0; i<nScripts; i++){
        let myuuid = uuidv7();
        preimages.push(myuuid);
      }

      
      for (var i = 0; i < preimages.length; i++) {
        let set = ECPair.makeRandom({network: this.network});
        if(i==0){
          this.merchantKeyPair = set;
        }
        const hash=bitcoin.crypto.sha256(Buffer.from(preimages[i]));
        let leafScriptAsm = `OP_SHA256 ${hash.toString('hex')} OP_EQUALVERIFY ${this.toXOnly(set.publicKey).toString('hex')} OP_CHECKSIG`;
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

      const info = await this.getRawTransaction(prevTransactionID);
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
      let info = await this.getRawTransaction(transactionToRedeemID);
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
            Buffer.from(preimage)
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

  async setUpIssuerTransactionSegwit(prevTransactionID, senderKeyPair, nScripts){
    try {    

      let preimages=[];
      let scriptAsm='';

      for (var i = 0; i < nScripts; i++) {
        let myuuid = uuidv7();
        preimages.push(myuuid);
        let set = ECPair.makeRandom({network: this.network});
        if(i==0){
          this.merchantKeyPair = set;
        }
        let hash=bitcoin.crypto.sha256(Buffer.from(preimages[i]));
        scriptAsm += `OP_DUP OP_SHA256 ${hash.toString('hex')} OF_IF OP_SHA256 ${hash.toString('hex')} OP_EQUALVERIFY ${this.toXOnly(set.publicKey).toString('hex')} OP_CHECKSIG OP_ELSE`;
        
      }
      
      const setUser = ECPair.makeRandom({network: this.network});
      scriptAsm += `OP_PUSHDATA1 90 OP_CHECKLOCKTIMEVERIFY OP_DROP ${this.toXOnly(setUser.publicKey).toString('hex')} OP_CHECKSIG`;

      for(var i = 0; i < nScripts; i++){
        scriptAsm+='OP_ENDIF'
      }

      let scriptInClear = scriptAsm.slice();
      let script = bitcoin.script.fromASM(scriptAsm);
      
      const p2wsh = bitcoin.payments.p2wsh({ 
        redeem: { 
          output: locking_script, 
          network: this.network 
        }, 
        network: this.network 
      });

      const info = await this.getRawTransaction(prevTransactionID);
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

      const destinationAddress = p2wsh.address; 

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
        'script': scriptInClear,
        'preimages': preimages
      };
          
      } catch (error) {
          console.error('Error in set up taproot transaction: ', error);
      }
  }

  async redeemTransactionSegwit(transactionToRedeemID, senderKeyPair, scriptString, preimage){
    try{
      let info = await this.getRawTransaction(transactionToRedeemID);
      let vout, amount, scriptHex; 

      for(let i=0; i<info.vout.length; i++){
        if(info.vout[i].value==this.priceForMerchant){
          vout=info.vout[i].n;
          amount=info.vout[i].value;
          scriptHex=info.vout[i].scriptPubKey.hex;
        }
      } 
          
      const p2wsh = bitcoin.payments.p2wsh({ 
        redeem: { 
          output: locking_script, 
          network: this.network 
        }, 
        network: this.network 
      });

      const psbt = new bitcoin.Psbt({ network: this.network });
      psbt.addInput({
        hash: transactionToRedeemID,
        index: vout,
        witnessUtxo: {
            script: p2wsh.output,
            value: Math.round(amount *  Math.pow(10, 8))
        },
        witnessScript: scriptString
      });
      
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

      const finalizeInput = (_inputIndex, input) => {
        const redeemPayment = payments.p2wsh({
          redeem: {
            input: script.compile([
              input.partialSig[0].signature,
              preimage
            ]),
            output: input.witnessScript
          }
        });

        const finalScriptWitness = witnessStackToScriptWitness(
          redeemPayment.witness ?? []
        );

        return {
          finalScriptSig: Buffer.from(""),
          finalScriptWitness
        }
      }

      psbt.finalizeInput(0, finalizeInput);

      const rawTx = psbt.extractTransaction().toHex();
      const txID = await this.core.broadcastTransaction(rawTx);
      return txID;

    }catch(error){
      console.error('Error in redeeming witness transaction: ', error);
    }
  }


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