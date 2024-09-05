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
const network = bitcoin.networks.regtest;
const hashes=[
  '5ac1e98bd96888758a72135240684568b0d1d4350a5d3d87736b807a838dd193',
  'acb25d781d0fae9fe90e17c16348a87ca2dbd39f4fc988965a138468dab7b787',
  '418de2ceac5129a866b6c3dd67ad1537102951e0bfe77398b37bfae092b84119'
];

const priceForUser=0.01
const priceForMerchant=0.008
const fee=0.0001

let core=new BitcoinCoreClient('testwallet1');
let merkleTree=[];
let scriptTree;

let userKeyPair;
let issuerKeyPair;
let merchantKeyPair;

function toXOnly(pubkey){
    return pubkey.subarray(1, 33)
}

async function broadcastTransaction(client, txHex){
  try{
    txID = await client.broadcastTransaction(txHex);
    return txID
  } catch (error) {
    console.error('Error in broadcast transaction: ', error);
  }
}

async function getRawTransaction(client, txID){
  try{
    info = await client.getRawTransaction(txID);
    return info
  } catch (error) {
    console.error('Error in retrieving transaction details: ', error);
  } 
} 

async function rechargeUserAddress(){
  userKeyPair = ECPair.makeRandom({network: network});
  const { address } = bitcoin.payments.p2pkh({ 
    pubkey: userKeyPair.publicKey,
    network: network 
  });

  txID = await core.makeTransaction(address, 0.02);
  return txID;

}

function createAddress() {
  const keyPair = ECPair.makeRandom();  
  const { address } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey });

  return { address, keyPair };
}

async function createTransaction(transactionID, senderKeyPair, amountInUTXO, amountToSend) {
  try{
    
    let info = await getRawTransaction(core, transactionID);
    let index, value;

    issuerKeyPair = ECPair.makeRandom({network: network});  
    let toAddress  =  bitcoin.payments.p2pkh({ 
      pubkey: issuerKeyPair.publicKey,
      network: network 
    }).address;

    let keyPair = ECPair.makeRandom({network: network});
    const changeAddress = bitcoin.payments.p2pkh({ 
      pubkey: keyPair.publicKey,
      network: network 
    }).address;


    for(var i= 0; i<info.vout.length; i++){
      if(info.vout[i].value==amountInUTXO){
        index = info.vout[i].n;
        value = info.vout[i].value;
      }
    } 
    const psbt = new bitcoin.Psbt({network:network});
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
      value: Math.round((value-amountToSend-fee) * Math.pow(10, 8)),
    });
    psbt.signInput(0, senderKeyPair);
    psbt.finalizeAllInputs();
    const rawTx = psbt.extractTransaction().toHex();
    const txID = await core.broadcastTransaction(rawTx);

    return txID;

  }catch (error) {
    console.error('Error creating transaction:', error);
  }
}


function createTaprootTree(scripts){
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
    let newTreeLeft=[createTaprootTree(left), {output: toInsertLeft, redeemVersion: 192}];
    let newTreeRight=[createTaprootTree(scripts), {output: toInsertRight, redeemVersion: 192}];
    return [newTreeLeft, newTreeRight];
  }
}

async function setUpIssuerTransaction(prevTransactionID, senderKeyPair){
  
  try {
  
    const internalKeyPair = ECPair.makeRandom({ network });
    const internalPubkey = internalKeyPair.publicKey.slice(1);
    let scripts=[];
    let scriptsInClear=[];

    const preimages=[
      '7c54a03433356add698847ef9b821573eacb6a7c8b8067536f16d6013b06097a',
      'cf479b769e607583b34ed0efaaf426c457309cd59ab6418d692d1becf451a4b1',
      '00b892a92c7425f4d4316c1e228ce0c7ecbcfed11612b34eeebeb123e5a829cf'
    ];

    for (var i = 0; i < hashes.length; i++) {
      let set = ECPair.makeRandom({network: network});
      if(i==0){
        merchantKeyPair = set;
      }
      let leafScriptAsm = `OP_SHA256 ${hashes[i]} OP_EQUALVERIFY ${toXOnly(set.publicKey).toString('hex')} OP_CHECKSIG`;
      let leafScript = bitcoin.script.fromASM(leafScriptAsm);
      console.log(leafScriptAsm)
      scripts.push(leafScript);
      scriptsInClear.push(leafScriptAsm);
    }

    const setUser = ECPair.makeRandom({network: network});
    let leafScriptAsm = `OP_PUSHDATA1 90 OP_CHECKLOCKTIMEVERIFY OP_DROP ${toXOnly(setUser.publicKey).toString('hex')} OP_CHECKSIG`;
    let leafScript = bitcoin.script.fromASM(leafScriptAsm);
    scripts.push(leafScript);
    scriptsInClear.push(leafScriptAsm);
    scriptHashes = scripts.map(x => bitcoin.crypto.sha256(x))
    
    merkleTree = new MerkleTree(scriptHashes, bitcoin.crypto.sha256);
    scriptTree = createTaprootTree(scripts);
    const root = merkleTree.getRoot().toString('hex');
    
    const p2tr = bitcoin.payments.p2tr({
        internalPubkey,
        scriptTree,
        network,
    });

    info = await getRawTransaction(core, prevTransactionID);
    let index, value;

    for(var i= 0; i<info.vout.length; i++){
      if(info.vout[i].value==priceForUser){
        index = info.vout[i].n;
        value = info.vout[i].value;
      }
    } 

    let keyPair = ECPair.makeRandom({network: network});
    const changeAddress = bitcoin.payments.p2pkh({ 
      pubkey: keyPair.publicKey,
      network: network 
    }).address;

    const prevTxId = prevTransactionID;
    const destinationAddress = p2tr.address; 

    const psbt = new bitcoin.Psbt({network:network});
    psbt.addInput({
      hash: info.hash,
      index: index,
      nonWitnessUtxo: Buffer.from(info.hex, 'hex'),
    });
    psbt.addOutput({
      address: destinationAddress,
      value: Math.round((priceForMerchant) * Math.pow(10, 8)),
    });
    psbt.addOutput({
      address: changeAddress,
      value: Math.round((value-priceForMerchant-fee) * Math.pow(10, 8)),
    });
    psbt.signInput(0, senderKeyPair);
    psbt.finalizeAllInputs();
    const rawTx = psbt.extractTransaction().toHex();
    const txID = await core.broadcastTransaction(rawTx);

    return {
      'txID':txID,
      'internalPublicKey': internalPubkey,
      'scripts': scriptsInClear,
      'rootTree': root,
      'preimages': preimages
    };
        
    } catch (error) {
        console.error('Error in set up taproot transaction: ', error);
    }
}

async function signTransactionToSend(client, txHex){
  try{
    result = await client.signTransaction(txHex);
    if(result.complete)
      return result.hex;
    else
      return 'error';
  } catch (error) {
        console.error('Error in signing transaction: ', error);
    }
}



async function redeemTransaction(transactionToRedeemID, senderKeyPair, internalPublickey, scriptString, preimage, proofPath){
  try{
    let info = await getRawTransaction(core, transactionToRedeemID);
    let vout, amount, scriptHex; 

    for(let i=0; i<info.vout.length; i++){
      if(info.vout[i].value==priceForMerchant){
        vout=info.vout[i].n;
        amount=info.vout[i].value;
        scriptHex=info.vout[i].scriptPubKey.hex;
      }
    } 
    //const versionByte = Buffer.from([0xc0]);
    const internalPubkey = Buffer.from(internalPublickey, 'hex');
    //const proofPathData = proofPath.map(item => item.data);
  
    const hash_lock_redeem = {
        output: bitcoin.script.fromASM(scriptString),
        redeemVersion: 192,
    };
    const hash_lock_p2tr = bitcoin.payments.p2tr({
        internalPubkey: internalPubkey,
        scriptTree,
        redeem: hash_lock_redeem,
        network
    });
    const tapLeafScript = {
        leafVersion: hash_lock_redeem.redeemVersion,
        script: hash_lock_redeem.output,
        controlBlock: hash_lock_p2tr.witness[hash_lock_p2tr.witness.length - 1] // SE RIESCI SOSTITUISCI CON PROOF PATH
    };

    const psbt = new bitcoin.Psbt({ network: bitcoin.networks.regtest });
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

    let keyPair = ECPair.makeRandom({network: network});
    const newMerchantAddress = bitcoin.payments.p2pkh({ 
      pubkey: keyPair.publicKey,
      network: network 
    }).address;

  
    psbt.addOutput({
      address: newMerchantAddress,
      value: Math.round((priceForMerchant-fee) * Math.pow(10, 8)), 
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
    const txID = await core.broadcastTransaction(rawTx);
    return txID;


/*
    const controlBlock1 = Buffer.concat([
      Buffer.from([0xc0]), 
      Buffer.from(internalPublickey, 'hex'), 
      ...proofPathData
    ]);
    const leafScript = bitcoin.script.fromASM(scriptString);
    const psbt = new bitcoin.Psbt({ network: bitcoin.networks.regtest });

    psbt.addInput({
      hash: transactionToRedeemID,
      index: vout,
      witnessUtxo: {
        script: Buffer.from(scriptHex, 'hex'), 
        value: amount * Math.pow(10, 8)
      },
        tapLeafScript: [
          {
            controlBlock: Buffer.from(controlBlock1),
            leafVersion: 0xc0,
                script: leafScript,
          }
        ]
    });

    const newMerchantAddress = await client.getNewAddress();
    const amountToSend = priceForMerchant * Math.pow(10, 8);
  
    psbt.addOutput({
      address: newMerchantAddress,
      value: amountToSend-fee, 
    });

    /*psbt.finalizeInput(0, (input, script) => {
      const witnessStack = [
        Buffer.from(preimage, 'hex'),
              Buffer.alloc(64, 0), // The signature placeholder
              leafScript
      ];
        return {
            finalScriptWitness: bitcoin.script.compile(witnessStack)
        };
    });*/


    /*psbt.updateInput(0, {
        finalScriptWitness: bitcoin.script.compile([
            preimage,
            Buffer.alloc(64, 0),  // Schnorr signature placeholder
        ])
    });*/


  }catch(error){
    console.error('Error in redeeming transaction: ', error);
  }
}



function test(){
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

function test2(){
  const scriptHex = 'a8205ac1e98bd96888758a72135240684568b0d1d4350a5d3d87736b807a838dd1938821039b7dc6ef21638fc419251f02ecc90c7af32425600c92de83bdb4b36c64285e41ac';
  const scriptBuffer = Buffer.from(scriptHex, 'hex');
  const scriptum = bitcoin.script.decompile(scriptBuffer);

  console.log('Decoded Script:', scriptum);
}

async function main() {
    try {
        const startTX = await rechargeUserAddress();
        await core.mineblocks(1);
        const transactionID = await createTransaction(startTX, userKeyPair, 0.02, priceForUser);
        await core.mineblocks(1);
        const taprootTransaction = await setUpIssuerTransaction(transactionID, issuerKeyPair);
        await core.mineblocks(1);

        const proof = merkleTree.getProof(bitcoin.crypto.sha256(bitcoin.script.fromASM(taprootTransaction.scripts[0])));
        
        const res = await redeemTransaction(
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

main();
