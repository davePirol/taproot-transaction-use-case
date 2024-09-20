const Controller = require('./controller.js');
const bitcoin = require('bitcoinjs-lib');
const { uuidv7 } = require('uuidv7');
const fs = require('fs');

async function printInfo(txID, controller, nScripts){
	const tx = await controller.getRawTransaction(txID);
    const bl = tx.size;
    const wu = tx.weight;
    const vb = tx.vsize;
    const nw = (wu - bl) / 3;
    const w = bl - nw;
    console.log(`-----------------transaction info (number of scripts: ${nScripts})-----------------`);
    console.log('total size: ', bl);
    console.log('weigth units: ', wu);
    console.log('virtual bytes: ', vb);
    console.log('size without witness: ', nw)
    console.log('Witness Size:', w);
    console.log('-------------------------------------------------------------------------------------');
}

async function printInfoComparison(txID1, txID2, controller, nScripts){
	const tx1 = await controller.getRawTransaction(txID1);
	const tx2 = await controller.getRawTransaction(txID2);
    const bl1 = tx1.size;
    const wu1 = tx1.weight;
    const vb1 = tx1.vsize;
    const nw1 = (wu1 - bl1) / 3;
    const w1 = bl1 - nw1;
    const bl2 = tx2.size;
    const wu2 = tx2.weight;
    const vb2 = tx2.vsize;
    const nw2 = (wu2 - bl2) / 3;
    const w2 = bl2 - nw2;
    console.log(`-----------------transaction info [taproot/segwit](number of scripts: ${nScripts+1})-----------------`);
    console.log('total size: '+ bl1+" / "+bl2);
    console.log('weigth units: ', wu1+" / "+wu2);
    console.log('virtual bytes: ', vb1+" / "+vb2);
    console.log('size without witness: ', nw1+" / "+nw2);
    console.log('Witness Size:', w1+" / "+w2);
    console.log('-------------------------------------------------------------------------------------');
}

async function computeResult(filename, txID, controller, nScripts){
	const tx = await controller.getRawTransaction(txID);
    const bl = tx.size;
    const wu = tx.weight;
    const vb = tx.vsize;
    const nw = (wu - bl) / 3;
    const w = bl - nw;
    const txsBlock = Math.floor((4000000-320) / wu);
    let row=bl+';'+wu+';'+vb+';'+nw+';'+w+';'+txsBlock+';'+(nScripts+1)+';\r\n';
	fs.appendFile(filename, row, function (err) {
	  if (err) throw err;
	});
}

async function transactionDimension(){

	fs.writeFile('dimension_taproot_lock.csv', 'SIZE; WEIGHT UNITS; VIRTUAL BYTES; NO WITNESS; WITNESS; TX PER BLOCK; N SCRIPTS;\r\n', function (err) {
	  if (err) throw err;
	}); 
	fs.writeFile('dimension_taproot_unlock.csv', 'SIZE; VIRTUAL SIZE; WEIGHT UNITS; VIRTUAL BYTES; WITNESS; TX PER BLOCK; N SCRIPTS;\r\n', function (err) {
	  if (err) throw err;
	});

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

		await computeResult('dimension_taproot_lock.csv', taprootInfo.txID, controller, numScripts); 
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

		await computeResult('dimension_taproot_unlock.csv', resTX, controller, numScripts); 
		await printInfo(resTX, controller, numScripts);

	}

}

async function comparisonDimension(){
	fs.writeFile('result_taproot_lock.csv', 'SIZE; WEIGHT UNITS; VIRTUAL BYTES; NO WITNESS; WITNESS; TX PER BLOCK; N SCRIPTS;\r\n', function (err) {
	  if (err) throw err;
	}); 
	fs.writeFile('result_taproot_unlock.csv', 'SIZE; WEIGHT UNITS; VIRTUAL BYTES; NO WITNESS; WITNESS; TX PER BLOCK; N SCRIPTS;\r\n', function (err) {
	  if (err) throw err;
	});

	fs.writeFile('result_segwit_lock.csv', 'SIZE; WEIGHT UNITS; VIRTUAL BYTES; NO WITNESS; WITNESS; TX PER BLOCK; N SCRIPTS;\r\n', function (err) {
	  if (err) throw err;
	});
	fs.writeFile('result_segwit_unlock.csv', 'SIZE; WEIGHT UNITS; VIRTUAL BYTES; NO WITNESS; WITNESS; TX PER BLOCK; N SCRIPTS;\r\n', function (err) {
	  if (err) throw err;
	});


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

		await computeResult('result_taproot_lock.csv', taprootInfo.txID, controller, numScripts);
		await computeResult('result_segwit_lock.csv', segwitInfo.txID, controller, numScripts);

		const resTX_taproot=await controller.redeemTransaction(
			taprootInfo.txID, 
			controller.merchantKeyPair, 
			taprootInfo.internalPublicKey, 
			taprootInfo.scripts[0], 
			taprootInfo.preimages[0], 
			null
		);
		const resTX_segwit=await controller.redeemTransactionSegwit(
			segwitInfo.txID, 
			controller2.merchantKeyPair, 
			segwitInfo.script, 
			segwitInfo.preimages[0], 
			null
		);
		await controller.mineBlock();

		await computeResult('result_taproot_unlock.csv', resTX_taproot, controller, numScripts);
		await computeResult('result_segwit_unlock.csv', resTX_segwit, controller, numScripts);

		await printInfoComparison(resTX_taproot, resTX_segwit, controller, numScripts);
	}
}





async function main(){
	
	/*
	### TEST ONE: show the increment of transaction space occupancy as increasing the taproot tree
	*/
	await transactionDimension();

	/*
	### TEST TWO: show the comparison of the space occupancy between a taproot transaction and an equivalent segwit
	*/
	await comparisonDimension();

}

main();