const bitcoin = require('bitcoinjs-lib');
const tinysecp = require('tiny-secp256k1');
const ECPairFactory = require('ecpair').ECPairFactory;
const ECPair = ECPairFactory(tinysecp);
const { BIP32Factory } = require('bip32');
const bip32 = BIP32Factory(tinysecp);
const BitcoinCoreClient = require('./BitcoinCoreClient.js')
const { MerkleTree } = require('merkletreejs');
//const bip341 = require('bip341');

bitcoin.initEccLib(tinysecp);
const network = bitcoin.networks.regtest;
const hashes=[
	'5ac1e98bd96888758a72135240684568b0d1d4350a5d3d87736b807a838dd193',
	'acb25d781d0fae9fe90e17c16348a87ca2dbd39f4fc988965a138468dab7b787',
	'418de2ceac5129a866b6c3dd67ad1537102951e0bfe77398b37bfae092b84119'
];
const pubKeyM=[
	'17bb5938b3657fc6965bb0f66bcccb7e36f60a876a2aea21eb8845888c8d2730',
	'd23dad7ea4b647cd9600c06f0570fb5a242dbe92d0097c311911d9d6ead97863',
	'a8428c79c4b07661c953eb4c7902a41ce8544217f2e136bbe887456aef1f9a39'
];

const priceForUser=0.01
const priceForMerchant=0.008

const merchants=['merch1', 'merch2', 'merch3'];

let user=new BitcoinCoreClient('userWallet');
let issuer=new BitcoinCoreClient('issuerWallet');
let dummy=new BitcoinCoreClient('testwallet1');
let merch1 = new BitcoinCoreClient('merchantWallet1');
let merch2 = new BitcoinCoreClient('merchantWallet1');
let merch3 = new BitcoinCoreClient('merchantWallet1');
let merkleTree=[];
let scriptTree;

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
			let merchantPublicKey = await getNewPublicKey(eval(merchants[i]))
	   		let leafScriptAsm = `OP_SHA256 ${hashes[i]} OP_EQUALVERIFY ${merchantPublicKey} OP_CHECKSIG`;
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
		
		//const proof = merkleTree.getProof(bitcoin.script.fromASM(`OP_PUSHDATA1 90 OP_CHECKLOCKTIMEVERIFY OP_DROP ${pubKeyUser} OP_CHECKSIG`));
		//console.log(proof)
		//const isValid = merkleTree.verify(proof, bitcoin.script.fromASM(`OP_PUSHDATA1 90 OP_CHECKLOCKTIMEVERIFY OP_DROP ${pubKeyUser} OP_CHECKSIG`), root);
		//console.log('Proof valid:', isValid);		

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
	  		],
	  		witness: [Buffer.from(preimage, 'hex')]
		});

		const newMerchantAddress = await client.getNewAddress();
		const amountToSend = priceForMerchant * Math.pow(10, 8);
	
		psbt.addOutput({
		  address: newMerchantAddress,
		  value: amountToSend, 
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


		//psbt.finalizeTaprootInput(0);

		/*psbt.updateInput(0, {
		    finalScriptWitness: bitcoin.script.compile([
		        preimage,  // Preimage satisfying OP_SHA256
		        Buffer.alloc(64, 0),  // Schnorr signature placeholder (to be replaced with actual signature)
		        leafScript,  // Redeem script
		        controlBlock  // Control block
		    ])
		});*/

		const txBase64=psbt.toBase64()

		res = await merch1.decodePsbt(txBase64)
		console.log(res);
		
		return txBase64;

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

async function main(user, issuer, merch1) {
    try {
        const startTX = await createTransaction(user, issuer, 0.01);
        const temp = await setUpIssuerTransaction(startTX);
        const temp2_tx = await signTransactionToSend(issuer, temp.txID);
        const taprootTX = await broadcastTransaction(issuer, temp2_tx);
        const proof = merkleTree.getProof(bitcoin.crypto.sha256(bitcoin.script.fromASM(temp.scripts[0])));
        //console.log(proof);
        const result = await redeemTransaction(
            merch1, 
            taprootTX, 
            temp.internalPublicKey,
            temp.scripts[0], 
            temp.preimages[0],
            proof
        );

        console.log(result);
    } catch (error) {
        console.error('Error processing transaction:', error);
    }
}



// Call the async function
main(user, issuer, merch1);
//test();
//test2();