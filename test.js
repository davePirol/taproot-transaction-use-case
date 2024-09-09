const Controller = require('./controller.js');
const bitcoin = require('bitcoinjs-lib');
const { uuidv7 } = require('uuidv7');



async function printInfo(txID, controller, nScripts){
	const tx = await controller.getRawTransaction(txID);
    const bl = tx.size;
    const wu = tx.weight;
    const vs = tx.vsize;
    const witnessSize = bl - vs;
    const vb = bl + Math.ceil(witnessSize / 4);
    console.log(`-----------------transaction info (number of scripts: ${nScripts})-----------------`);
    console.log('base size (wo witness): ', bl);
    console.log('virtual size (w witness): ', vs);
    console.log('weigth units: ', wu);
    console.log('virtual bytes: ', vb);
    console.log('Witness Size:', witnessSize);
    console.log('-------------------------------------------------------------------------------------');
}

async function printInfoComparison(txID1, txID2, controller, nScripts){
	const tx1 = await controller.getRawTransaction(txID1);
	const tx2 = await controller.getRawTransaction(txID2);
    const bl1 = tx1.size;
    const wu1 = tx1.weight;
    const vs1 = tx1.vsize;
    const witnessSize1 = bl1 - vs1;
    const vb1 = bl1 + Math.ceil(witnessSize1 / 4);
    const bl2 = tx2.size;
    const wu2 = tx2.weight;
    const vs2 = tx2.vsize;
    const witnessSize2 = bl2 - vs2;
    const vb2 = bl2 + Math.ceil(witnessSize2 / 4);
    console.log(`-----------------transaction info [taproot/segwit](number of scripts: ${nScripts})-----------------`);
    console.log('base size (wo witness): '+ bl1+" / "+bl2);
    console.log('virtual size (w witness): ', vs1+" / "+vs2);
    console.log('weigth units: ', wu1+" / "+wu2);
    console.log('virtual bytes: ', vb1+" / "+vb2);
    console.log('Witness Size:', witnessSize1+" / "+witnessSize2);
    console.log('-------------------------------------------------------------------------------------');
}

async function transactionDimension(){

	for (let numScripts=1; numScripts<=1000000; numScripts*=10){

		const controller = new Controller();
		await controller.loadWallet();

		const toUserTx = await controller.rechargeUserAddress();
		await controller.mineBlock();

		const toIssuerTx = await controller.createTransaction(
	        toUserTx,
	        controller.userKeyPair,
	        0.02,
	        controller.priceForUser
	    );
	    await controller.mineBlock();

	    const taprootInfo = await controller.setUpIssuerTransaction(toIssuerTx, controller.issuerKeyPair, numScripts);
		await controller.mineBlock();

		await printInfo(taprootInfo.txID, controller, numScripts);

		const resTX=await controller.redeemTransaction(
			taprootInfo.txID, 
			controller.merchantKeyPair, 
			taprootInfo.internalPublicKey, 
			taprootInfo.scripts[0], 
			taprootInfo.preimages[0], 
			null
		);
		await controller.mineBlock();

		await printInfo(resTX, controller, numScripts);

	}

}

async function comparisonDimension(){
	for (let numScripts=1; numScripts<=100; numScripts++){
		const controller = new Controller();
		const controller2 = new Controller();
		await controller.loadWallet();

		const toUserTx = await controller.rechargeUserAddress();
		const toUserTx2 = await controller2.rechargeUserAddress();
		await controller.mineBlock();

		const toIssuerTx = await controller.createTransaction(
	        toUserTx,
	        controller.userKeyPair,
	        0.02,
	        controller.priceForUser
	    );
	    const toIssuerTx2 = await controller2.createTransaction(
	        toUserTx2,
	        controller2.userKeyPair,
	        0.02,
	        controller2.priceForUser
	    );
	    await controller.mineBlock();

	    const taprootInfo = await controller.setUpIssuerTransaction(toIssuerTx, controller.issuerKeyPair, numScripts);
	    const segwitInfo = await controller2.setUpIssuerTransactionSegwit(toIssuerTx2, controller2.issuerKeyPair, numScripts);
		await controller.mineBlock();

		//await printInfoComparison(taprootInfo.txID, segwitInfo.txID, controller, numScripts);

		const resTX=await controller.redeemTransaction(
			taprootInfo.txID, 
			controller.merchantKeyPair, 
			taprootInfo.internalPublicKey, 
			taprootInfo.scripts[0], 
			taprootInfo.preimages[0], 
			null
		);
		const resTX2=await controller.redeemTransactionSegwit(
			segwitInfo.txID, 
			controller2.merchantKeyPair, 
			segwitInfo.script, 
			segwitInfo.preimages[0], 
			null
		);
		await controller.mineBlock();

		await printInfoComparison(resTX, resTX2, controller, numScripts);
	}
}

async function percentageBlockTaproot(){

}

async function percentageBlockSegwit(){

}

async function main(){
	
	/*
	### TEST ONE: show the increment of transaction space occupancy as increasing the taproot tree
	*/
	//await transactionDimension();

	/*
	### TEST TWO: show the comparison of the space occupancy between a taproot transaction and an equivalent segwit
	*/
	await comparisonDimension();


}

main();


/*let myuuid = uuidv7();
console.log('pre: ', myuuid);
const hash=bitcoin.crypto.sha256(Buffer.from(myuuid));
console.log('primo hash: ',hash.toString('hex'));
const hash2=bitcoin.crypto.sha256(Buffer.from(myuuid));
console.log('secondo hash: ',hash2.toString('hex'));
*/