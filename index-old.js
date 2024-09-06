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
const fee=1000

const merchants=['merch1', 'merch2', 'merch3'];

let user=new BitcoinCoreClient('userWallet');
let issuer=new BitcoinCoreClient('issuerWallet');
let dummy=new BitcoinCoreClient('testwallet1');
let merch1 = new BitcoinCoreClient('merchantWallet1');
let merch2 = new BitcoinCoreClient('merchantWallet2');
let merch3 = new BitcoinCoreClient('merchantWallet3');
let merkleTree=[];
let scriptTree;

//TODO da sistemare nella funzione
let privKey;

async function getWalletUTXOs(client){
	try {
		return await client.getUTXOList();
	} catch (error) {
        console.error('Error retrieving UTXO list:', error);
    }
}

async function mineBlocks(nBlocks){
	try {
		await dummy.mineblocks(nBlocks);
	}catch (error) {
		console.error('Error mining blocks:', error);
    }	
}

async function createTransaction(sender, receiver, amountToSend) {
	try{
		destinationAddress = await receiver.getNewAddress();
		transactionHEX = await sender.makeTransaction(destinationAddress, amountToSend);
		return transactionHEX;

	}catch (error) {
		console.error('Error creating transaction:', error);
	}
}

async function selectUTXOsForPayment(sender, receiver, amountNeeded) {
	const utxos = await getWalletUTXOs(sender);
	const selectedUTXOs = [];
	let totalValue = 0;

	utxos.sort((a, b) => a.value - b.value);

	// Select UTXOs until the total value covers the amount needed
	for (const utxo of utxos) {
		selectedUTXOs.push(utxo);
		totalValue += utxo.value;

		if (totalValue >= amountNeeded) {
			break;
		}
	}

	// Check if the total value of selected UTXOs is sufficient
	if (totalValue < amountNeeded) {
		throw new Error('Insufficient funds: Unable to find enough UTXOs to cover the amount needed.');
	}

	return {
		utxos: selectedUTXOs,
		totalValue: totalValue
	};
}

function createTaprootTree(scripts){
	if(scripts.length==0){
		return;
	}
	if(scripts.length==1){
		return {output: scripts[0]};
	}else if(scripts.length==2){
		return [{output: scripts[0]}, {output: scripts[1]}]
	}else{

		let left=scripts.splice(0, scripts.length/2)
		let toInsertLeft=left[0];
		let toInsertRight=scripts[0];
		left.shift();
		scripts.shift();
		let newTreeLeft=[createTaprootTree(left), {output: toInsertLeft}];
		let newTreeRight=[createTaprootTree(scripts), {output: toInsertRight}];
		return [newTreeLeft, newTreeRight];
	}
}

async function setUpIssuerTransaction(prevTransactionID){
	
	try {
	
		const keyPair = ECPair.makeRandom({ network });
	    const internalPubkey = keyPair.publicKey.slice(1);
		let scripts=[];
		let scriptsInClear=[];
		const pubKeyUser = await getNewPublicKey(user);

		const preimages=[
			'7c54a03433356add698847ef9b821573eacb6a7c8b8067536f16d6013b06097a',
			'cf479b769e607583b34ed0efaaf426c457309cd59ab6418d692d1becf451a4b1',
			'00b892a92c7425f4d4316c1e228ce0c7ecbcfed11612b34eeebeb123e5a829cf'
		];

		for (var i = 0; i < hashes.length; i++) {
			let pubKey = await getNewPublicKey(eval(merchants[i]))
	   		let leafScriptAsm = `OP_SHA256 ${hashes[i]} OP_EQUALVERIFY ${pubKey} OP_CHECKSIG`;
			let leafScript = bitcoin.script.fromASM(leafScriptAsm);
			scripts.push(leafScript);
			scriptsInClear.push(leafScriptAsm);
	   	}

	   	let leafScriptAsm = `OP_PUSHDATA1 90 OP_CHECKLOCKTIMEVERIFY OP_DROP ${pubKeyUser} OP_CHECKSIG`;
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

		info = await getRawTransaction(issuer, prevTransactionID);
		let prevIndex, prevValue;

		for(var i= 0; i<info.vout.length; i++){
			if(info.vout[i].value==priceForUser){
				prevIndex = info.vout[i].n;
				prevValue = info.vout[i].value;
			}
		}	

		const prevTxId = prevTransactionID;
		const destinationAddress = p2tr.address; 
		const sendAmount = priceForMerchant * Math.pow(10, 8);

		const tx = new bitcoin.Transaction();
		tx.addInput(Buffer.from(prevTransactionID, 'hex').reverse(), prevIndex);
		tx.addOutput(p2tr.output, sendAmount);
		const unsignedTxHex = tx.toHex();  
		return {
			'txID':unsignedTxHex,
			'internalPublicKey': internalPubkey,
			'scripts': scriptsInClear,
			'rootTree': root,
			'preimages': preimages
		};
        
    } catch (error) {
        console.error('Error in set up taproot transaction: ', error);
    }
}

async function getNewAddress(client){
	try{
		let newAddress = await client.getNewAddress();
		return newAddress;
	}catch(error){
		console.error('Error in generating new address: ', error);
	}
}

async function getNewPublicKey(client){
	try{
		let newAddress = await client.getNewAddress();
		let publicKey = await client.getPubKeyFromAddress(newAddress);
		return publicKey;
	}catch(error){
		console.error('Error in generating public key from a new address: ', error);
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

async function redeemTransaction(client, transactionToRedeemID, internalPublickey, scriptString, preimage, proofPath){
	try{

		const txid = transactionToRedeemID;
		let info = await getRawTransaction(client, transactionToRedeemID);
		let vout, amount, scriptHex; 

		for(let i=0; i<info.vout.length; i++){
			if(info.vout[i].value==priceForMerchant){
				vout=info.vout[i].n;
				amount=info.vout[i].value;
				scriptHex=info.vout[i].scriptPubKey.hex;
			}
		} 
		const versionByte = Buffer.from([0xc0]);
		const internalPubkey = Buffer.from(internalPublickey, 'hex');
		const proofPathData = proofPath.map(item => item.data);
		
		//console.log(internalPubkey)


		//TEST
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
		    controlBlock: hash_lock_p2tr.witness[hash_lock_p2tr.witness.length - 1]
		};

		const psbt = new bitcoin.Psbt({ network: bitcoin.networks.regtest });
		psbt.addInput({
			hash: transactionToRedeemID,
			index: vout,
			witnessUtxo: {
				script: hash_lock_p2tr.output, 
				value: amount * Math.pow(10, 8)
			},
		  	tapLeafScript: [
		  		tapLeafScript
	  		]
		});
		const newMerchantAddress = await client.getNewAddress();
		const amountToSend = priceForMerchant * Math.pow(10, 8);
	
		psbt.addOutput({
		  address: newMerchantAddress,
		  value: amountToSend-fee, 
		});

		const txBase64=psbt.toBase64();
		return txBase64;

		//TEST FINE



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
//		        Buffer.alloc(64, 0),  // Schnorr signature placeholder
		    ])
		});*/


/*		const txBase64=psbt.toBase64()

		//res = await merch1.decodePsbt(txBase64)
		//console.log(res);

		

		return txBase64;
*/

	}catch(error){
		console.error('Error in redeeming transaction: ', error);
	}
}

function finalizePsbt(psbtBase64, preimage, tapLeafScript) {
    const psbt = bitcoin.Psbt.fromBase64(psbtBase64);


    const customFinalizer = (_inputIndex, input) => {
    	//console.log(input.tapScriptSig)
	    const scriptSolution = [
	        input.tapScriptSig[0].signature,
	        preimage
	    ];
	    const witness = scriptSolution
	        .concat(tapLeafScript.script)
	        .concat(tapLeafScript.controlBlock);

	    return {
	        finalScriptWitness: witnessStackToScriptWitness(witness)
	    }
	}

	psbt.finalizeInput(0, customFinalizer);

    const rawTransaction = psbt.extractTransaction().toHex();
    return rawTransaction;
}

async function processPSBT(client, psbtBase64){
	try{
	    let res = await client.processPSBT(psbtBase64);
		return res;
	}catch(error){
		console.error('Error in processing partial transaction: ', error);
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

async function main(user, issuer, merch1) {
    try {
        const startTX = await createTransaction(user, issuer, 0.01);
        const temp = await setUpIssuerTransaction(startTX);
        const temp2_tx = await signTransactionToSend(issuer, temp.txID);
        const taprootTX = await broadcastTransaction(issuer, temp2_tx);
        const proof = merkleTree.getProof(bitcoin.crypto.sha256(bitcoin.script.fromASM(temp.scripts[0])));
        const txBase64 = await redeemTransaction(
            merch1, 
            taprootTX, 
            temp.internalPublicKey,
            temp.scripts[0], 
            temp.preimages[0],
            proof
        );

        let inter=await processPSBT(merch1, txBase64);

        res = await merch1.decodePsbt(inter.psbt);
        console.log(res);

        const rawTx = finalizePsbt(inter.psbt, temp.preimages[0]);

        console.log(rawTx);
    } catch (error) {
        console.error('Error processing transaction:', error);
    }
}



// Call the async function
main(user, issuer, merch1);
//test();
//test2();