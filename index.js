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

const priceForUser=0.01
const priceForMerchant=0.008

let merchants=[];

let user=new BitcoinCoreClient('userWallet');
let issuer=new BitcoinCoreClient('issuerWallet');
let dummy=new BitcoinCoreClient('testwallet1');
let merch1 = new BitcoinCoreClient('merchantWallet1');
let merch2 = new BitcoinCoreClient('merchantWallet1');
let merch3 = new BitcoinCoreClient('merchantWallet1');

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
	}else{
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
		return unsignedTxHex;
        
    } catch (error) {
        console.error('Error in set up taproot transaction: ', error);
    }
}

async function signTransactionToSend(client, txHex){
	try{
		result = await client.signTransaction(txHex);
		if(result.complete)
			return txID;
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

async function redeemTransaction(client, transactionToRedeemID, scriptString, preimage){
	try{

		const txid = transactionToRedeemID;
		let info = await getRawTransaction(client);
		let vout, amount, scriptHex; 
		for(let i=0; i<info.vout.length; i++){
			if(info.vout[i].value==priceForMerchant){
				vout=info.vout[i].n;
				amount=info.vout[i].amount;
				scriptHex=info.vout[i].scriptPubKey.hex;
			}
		} 

		const utxo = {
		    txid: txid,
		    vout: vout,
		    amount: amount,
		    scriptPubKey: scriptHex
		};
		const leafScript = bitcoin.script.fromASM(leafScriptAsm);

		const txb = new bitcoin.TransactionBuilder(bitcoin.networks.regtest);
		txb.addInput(utxo.txid, utxo.vout, null, Buffer.from(utxo.scriptPubKey, 'hex'));

		const newMerchantAddress = await client.getNewAddress();
		const amountToSend = priceForMerchant * Math.pow(10, 8);
		txb.addOutput(receiverAddress, amountToSend);

		const witnessStack = [
		    Buffer.from('empty_signature_placeholder', 'hex'),
		    Buffer.from(preimage),   
		    leafScript,
		];


		txb.addWitness(0, witnessStack);

		const tx = txb.build();
		const txHex = tx.toHex();
		return unsignedTxHex;

	}catch(error){
		console.error('Error in redeeming transaction: ', error);
	}
}

//createTransaction(user, issuer, 0.01).then((result)=>console.log(result))
//setUpIssuerTransaction('cca93b0e90352e9c24eacb74013c022a1e53c888fa80260662104aad95bc4c53').then((result)=>console.log(result))
//signTransactionToSend(issuer, '0100000001534cbc95ad4a1062062680fa88c8531e2a023c0174cbea249c2e35900e3ba9cc0000000000ffffffff0100350c0000000000225120cf62bf9801c09811952a3949948ac6de9bd00182d646f73dda4ef68c514b1e2d00000000')
//	.then((result)=>console.log(result));
//broadcastTransaction(issuer, '01000000000101534cbc95ad4a1062062680fa88c8531e2a023c0174cbea249c2e35900e3ba9cc0000000000ffffffff0100350c0000000000225120cf62bf9801c09811952a3949948ac6de9bd00182d646f73dda4ef68c514b1e2d02473044022020c67db171db56c53aca383e665be43477c89c34ec7b75c76dc3de63dea4d9af022058bf43bce54a4c507e9352b4e4fee3d99d9581963f0d265663a27cb4f959b3ed012103281ef9e6d19b69e901578a6c6044f180a552bdbc13d305d073a2496b5e01014d00000000')
//	.then((result) => console.log(result)); --> a7e31e0a38e966672f072a5521f525c3baf66ec3f32c5705535a02537f58e084