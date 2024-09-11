const { parse } = require("csv-parse");
const fs = require('fs').promises;
const readline = require('node:readline');
const Controller = require('./controller.js');
const util = require('util');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = util.promisify(rl.question).bind(rl);
let selectedPacket;
let scripts;
let secrets;

async function createPacketsTree(){
	let toWrite={
		'merkleRoot': '1234567890123456789012345678901234567890123456789012345678901234',
		'packets': [
			{
				'txID': '1234567890123456789012345678901234567890123456789012345678901234',
				'internalPublicKey': '1234567890123456789012345678901234567890123456789012345678901234',
				'rootTree': '1234567890123456789012345678901234567890123456789012345678901234',
				'secret' : [
					'',
					'',
					'',
				],
				'scripts' : [
					'',
					'',
					'',
					''
				]
			}
		]
		
	}
	fs.writeFileSync('./packet_tree.json', toWrite);
}

async function parseCSV(content) {
    return new Promise((resolve, reject) => {
        parse(content, { delimiter: ';', from_line: 2 }, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}


async function seeCatalog(controller){
	console.log('Here you can choose among the services packet below');
	try {
  		const content = await fs.readFile('./catalogue.csv', { encoding: 'utf8' });
	    const rows = await parseCSV(content);

        rows.forEach((item, index) => {
            console.log(`${index + 1}) ${item[0]}`);
            console.log(`\tOption 1: ${item[2]}`);
            console.log(`\tOption 2: ${item[3]}`);
            console.log(`\tOption 3: ${item[4]}`);
            console.log(`Price: ${item[1]}B`);
            console.log('-------------------------------------');
        });

        const res = await question(`Please choose and purchase one packet and insert the index: `);
        const choice = res - 1;

        if (choice >= 0 && choice < rows.length) {
            selectedPacket = rows[choice];

            const res2 = await question(`You chose ${selectedPacket[0]}. Confirm by writing 'yes': `);
            if (res2.toLowerCase() === 'yes') {
                const res3 = await question(`Thank you, provide the transaction ID that you want to spend: `);

                const toIssuerTx = await controller.createTransaction(
                    res3,
                    controller.userKeyPair,
                    0.02,
                    controller.priceForUser
                );
                console.log('Transaction created successfully:', toIssuerTx);

                return toIssuerTx;
            } else {
                console.log('Purchase cancelled.');
                rl.close();
                return null;
            }
        } else {
            console.log('Invalid choice.');
            rl.close();
            return null;
        }	   
	} catch (err) {
	  console.error(err);
	}
}

async function prepareTaprootTransaction(controller, userTX){
	controller.setUpIssuerTransaction(userTX, controller.issuerKeyPair, 3).then((issuerInfo)=>{
		console.log('You has just recived the information about your purchased packet. Keep them secret!!');
		//TODO memorizzare in un file le info dell'acquisto in un albero
		console.log('#################################################')
		console.log('transaction ID: ', issuerInfo.txID);
		console.log('internal public key: ', issuerInfo.internalPublicKey);
		console.log('merkle root: ', issuerInfo.rootTree);
		console.log('secret codes: ');
		issuerInfo.preimages.forEach((item) => {
	        console.log('\t',item);
	    });
		console.log('scripts list: ');
		issuerInfo.scripts.forEach((item) => {
	        console.log('\t',item);
	    });
	    console.log('#################################################');
	    scripts=issuerInfo.scripts;
	    secrets=issuerInfo.preimages;
	});
}

async function selectMerchant(controller){
	const reply = parseInt(await question(`Please select the experience you want to unlock (index option): `)) + 1;
	const reply2 = await question(`You chose ${selectedPacket[reply]}. Confirm by writing 'yes': `);
        if (reply2.toLowerCase() === 'yes') {	
        	console.log('Now informs the merchant about the transaction ID, the secret index and the internal public key')
        	const txID = await question(`Transaction ID: `);
			const index = parseInt(await question(`Secret index: `))-1;
			const intPubKey = await question(`Internal public key: `);
        	const resTX=await controller.redeemTransaction(txID, controller.merchantKeyPair, intPubKey, scripts[index], secrets[index], null);
        	console.log('Unlocking complete, transaction has been confirmed: ', resTX);
        }
    rl.close();
}

async function main(){
	const c = new Controller();
	await c.loadWallet();
	console.log('As first thing we provide you a transaction ID ready to be spent:');
	const toUserTx = await c.rechargeUserAddress();

	await c.mineBlock();
	
	console.log(toUserTx);
	console.log('**** Welcome on the service platform ****');

	const userTX = await seeCatalog(c);
	console.log('You can explore the blockchain and see you transaction committed');

	await c.mineBlock();

	await prepareTaprootTransaction(c, userTX);
	await c.mineBlock();

	await selectMerchant(c);
	await c.mineBlock();
}

main().catch(error => {
    console.error('Error:', error);
});