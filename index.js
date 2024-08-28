const bitcoin = require('bitcoinjs-lib');
const tinysecp = require('tiny-secp256k1');
const ECPairFactory = require('ecpair').ECPairFactory;
const ECPair = ECPairFactory(tinysecp);
const { BIP32Factory } = require('bip32');
const bip32 = BIP32Factory(tinysecp);
const BitcoinCoreClient = require('./BitcoinCoreClient.js')

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

let user=new BitcoinCoreClient('userWallet');
let issuer=new BitcoinCoreClient('issuerWallet');
let dummy=new BitcoinCoreClient('testwallet1');


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
	
	if(scripts.length==1){
		return {output: scripts[0]};
	}/*else if(scripts.lenght==2){
		tree.push([{output: scripts[0]}, {output: scripts[1]}])
		scripts.shift();
		scripts.shift();
		return tree;
	}*/else{
		let toInsert=scripts[0];
		scripts.shift();
		let newTree=[createTaprootTree(scripts), {output: toInsert}];
		return newTree;
	}
}

async function setUpIssuerTransaction(prevTransactionID){
	
	try {
	
		const keyPair = ECPair.makeRandom({ network });
	    const internalPubkey = keyPair.publicKey.slice(1);
		let scripts=[];
		const userAddress = await user.getNewAddress();
		const pubKeyUser = await user.getPubKeyFromAddress(userAddress);

		for (var i = hashes.length - 1; i >= 0; i--) {
	   		let leafScriptAsm = `OP_SHA256 ${hashes[i]} OP_EQUALVERIFY ${pubKeyM[i]} OP_CHECKSIG`;
			let leafScript = bitcoin.script.fromASM(leafScriptAsm);
			scripts.push(leafScript);
	   	}

	   	let leafScriptAsm = `OP_PUSHDATA1 90 OP_CHECKLOCKTIMEVERIFY OP_DROP ${pubKeyUser} OP_CHECKSIG`;
		let leafScript = bitcoin.script.fromASM(leafScriptAsm);
		scripts.push(leafScript);		
		const scriptTree = createTaprootTree(scripts);
	
		const p2tr = bitcoin.payments.p2tr({
		    internalPubkey,
		    scriptTree,
		    network,
		});


		info = await issuer.getRawTransaction(issuer);
		console.log(info);
		return;

		const prevTxId = prevTransactionID;  // Replace with the actual transaction ID
		const prevIndex = 0;  // Index of the output in the previous transaction
		const prevValue = 100000; 

		const destinationAddress = 'destination-address'; 
		const sendAmount = 90000;

		// Initialize the PSBT
		const psbt = new bitcoin.Psbt({ network });

		// Add the input
		psbt.addInput({
		    hash: prevTxId,
		    index: prevIndex,
		    witnessUtxo: {
		        script: p2tr.output,
		        value: prevValue,
		    },
		    tapLeafScript: [{
		        leafVersion: scriptTree[0].version,
		        script: scriptTree[0].output,
		        controlBlock: bitcoin.script.witnessScriptHash.output.encode(p2tr.witness[1])
		    }],
		});

		// Add the output
		psbt.addOutput({
		    address: destinationAddress,
		    value: sendAmount,
		});

		// Sign the transaction using the private key
		psbt.signInput(0, keyPair);

		// Finalize the transaction
		psbt.finalizeAllInputs();

		// Extract the transaction and get the hex
		const tx = psbt.extractTransaction();
		console.log("Raw Transaction Hex:", tx.toHex());
        
    } catch (error) {
        console.error('Error in sending funds from user wallet: ', error);
    }
}


//createTransaction(user, issuer, 1).then((result)=>console.log(result))
setUpIssuerTransaction('996ea13717bbdbea1363c76010ba86d395f41407b467456ba0519b47302bc267')