const { Web3 } = require('web3');
const ethers = require('ethers');
const fs = require('fs');
const cluster = require('cluster');
var numCPUs = require('os').availableParallelism();
const process = require('process');

// const rpc = 'https://opbnb-testnet-rpc.bnbchain.org'
const rpc = 'https://rpc-l2.hamsterbox.xyz'

const provider = new ethers.providers.JsonRpcProvider(rpc);
const web3 = new Web3(rpc);

// 0xac6f56D5bF6Ac760A2e2Ce99204b23b7D85d1a08
const owner = web3.eth.accounts.privateKeyToAccount('0x433b95ad6a5a3f784693ed2724e6cd76747d48f40829c175adcc724d14dc5208')

const gasPrice = '1.5'
const sendAmount = '0.0001'
const sendAmountForTest = '0.000000001'
const sleepTime = 5000;
const chainId = 1995;
// const MAX_LEVEL = 9;
// const MAX_WALLET = 500;

const MAX_LEVEL = 2;
const MAX_WALLET = 3;


async function sleep(n) { 
    return new Promise(resolve => { 
        setTimeout(resolve, n); 
    }) 
}

async function sleep10() { 
    return new Promise(resolve => { 
        var id = setInterval(() => {
            if (Math.floor(Date.now() / 1000) % 10 == 0) {
                clearInterval(id)
                resolve()
            }
        })
    }) 
}

async function sleep30() { 
    return new Promise(resolve => { 
        var id = setInterval(() => {
            if (Math.floor(Date.now() / 1000) % 30 == 0) {
                clearInterval(id)
                resolve()
            }
        })
    }) 
}

async function sleep5() { 
    return new Promise(resolve => { 
        var id = setInterval(() => {
            if (Math.floor(Date.now() / 1000) % 5 == 0) {
                clearInterval(id)
                resolve()
            }
        })
    }) 
}

function amountForSend(n) {
    var amount = parseFloat(sendAmount)
    var amountForInit = amount * Math.pow(2, n + 3);
    amountForInit = parseFloat(amountForInit.toFixed(8)).toString()

    return amountForInit
}

async function signTx(amount, sender, receiverAddress, nonce) {
    try {
        const wallet = new ethers.Wallet(sender.privateKey, provider);

        const transaction = {
            to: receiverAddress,
            value: ethers.utils.parseEther(amount.toString()), // Chuyển số lượng Ether thành wei
            gasPrice: ethers.utils.parseUnits(gasPrice, 'gwei'), // Gas price (1 gwei)
            gasLimit: 21000, // Gas limit cho giao dịch chuyển tiền
        };

        if (nonce >= 0) {
            transaction.nonce = nonce
        }

        if (chainId) {
            transaction.chainId = chainId
        }

        return await wallet.signTransaction(transaction);
    } catch (error) {
        console.error(error);
        return null;
    }
}

async function prepareWalletForAllCluster() {
    var nonce = await provider.getTransactionCount(owner.address);
    var wallets = []
    for (let i = 0; i < numCPUs; i++) {
        var w = web3.eth.accounts.create()
        var amountForInit = amountForSend(MAX_LEVEL + 1)
        console.log("BALANCE FOR INIT: ", MAX_LEVEL, amountForInit)

        await provider.sendTransaction(
            await signTx(amountForInit, owner, w.address, nonce++)
        )
        console.log(i, w.address)
        wallets.push({
            address: w.address,
            privateKey: w.privateKey,
            nonce: 0
        })
    }

    fs.writeFileSync('./wallets/wallets-for-cluster.json', JSON.stringify(wallets, null, 2), 'utf-8')
    console.log('Done prepare wallet for cluster')
}

async function sendMultiLayer(id, n, maxwallet, wallets) {
    var signedTxs = [];
    var newWallets = [];
    var amountForInit = '0';
    if (maxwallet > wallets.length) {
        amountForInit = amountForSend(n)
        console.log('+', cluster.worker.id, `${n}|${wallets.length}/${maxwallet}: ${amountForInit}`)
    }

    for (var i = 0; i < wallets.length; i++) {
        if (wallets.length + newWallets.length < maxwallet) {
            var w = web3.eth.accounts.create()
            newWallets.push({
                address: w.address,
                privateKey: w.privateKey,
                nonce: 0
            })
            try {
                signedTxs.push(await signTx(amountForInit, wallets[i], w.address, wallets[i].nonce))
            }
            catch (ex) {
                
            }
            wallets[i].nonce++;
        }
        else {
            try {
                signedTxs.push(await signTx(sendAmountForTest, wallets[i], wallets[i].address, wallets[i].nonce))
            }
            catch (ex) {

            }
            wallets[i].nonce++;
        }
    }
    await sleep10()
    console.log('>', cluster.worker.id, `${signedTxs.length}/${wallets.length}/${maxwallet}`)
    var success = 0;
    var error = 0;
    await Promise.all(signedTxs.map(async e => {
        try {
            await provider.sendTransaction(e)
            success++
        }
        catch (ex) {
            error++
        }
    }))
    wallets = wallets.concat(newWallets)
    fs.writeFileSync(`./wallets/w${id}.json`, JSON.stringify(wallets, null, 4), 'utf-8')
    console.log(' ', cluster.worker.id, `${signedTxs.length}/${wallets.length}/${maxwallet}:`, `${success}/${error}`)
    if (maxwallet > wallets.length) {
        await sleep(sleepTime);
    }
    else if (maxwallet > 500) {
        await sleep30()
    }
    else if (maxwallet > 100) {
        await sleep10()
    }
    else {
        await sleep5()
    }
    await sendMultiLayer(id, n - 1, maxwallet, wallets);
}

async function main() {
    // numCPUs = 1;
    if (cluster.isPrimary) {
        console.log(`Primary ${process.pid} is running`);
        await prepareWalletForAllCluster()

        for (let i = 0; i < numCPUs; i++) {
            cluster.fork();
        }

        cluster.on('exit', (worker, code, signal) => {
            console.log(`worker ${worker.process.pid} died`);
        });
    } else {
        console.log(`Worker ${process.pid} started`, cluster.worker.id);
        await sleep(5000)
        const wallets = require('./wallets/wallets-for-cluster.json');
        await sendMultiLayer(cluster.worker.id, MAX_LEVEL, MAX_WALLET, [wallets[cluster.worker.id - 1]])
    }
}

main()