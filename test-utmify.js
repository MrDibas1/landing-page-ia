const https = require('https');
require('dotenv').config();

const utmifyToken = process.env.UTMIFY_TOKEN || 'JBzJB6WK1VTtEFv8rYtkflNbxkCABpytA6T0';

// Format date helper: YYYY-MM-DD HH:MM:SS
function formatDate(dateStr) {
    if (!dateStr) return new Date().toISOString().replace('T', ' ').substring(0, 19);
    try {
        const date = new Date(dateStr);
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const hh = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        const ss = String(date.getSeconds()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
    } catch (e) {
        return new Date().toISOString().replace('T', ' ').substring(0, 19);
    }
}

// 1. Current payload structure (from server.js)
const oldOrderData = {
    orderId: "test_old_" + Date.now(),
    platform: 'StudioAI',
    paymentMethod: 'pix',
    status: 'paid',
    createdAt: new Date().toISOString(), // ISO String
    approvedDate: new Date().toISOString(), // ISO String
    customer: {
        name: 'Cliente Teste Antigo',
        email: 'teste_antigo@exemplo.com',
        phone: '5511999999999',
        document: '12345678909'
    },
    items: [
        {
            id: 'premium_10',
            title: 'Pack 10 Fotos + 5 Brindes',
            price: 8999, // price in cents
            qty: 1
        }
    ],
    utms: {
        utmSource: 'src_test',
        utmMedium: 'med_test',
        utmCampaign: 'camp_test',
        utmContent: 'cont_test',
        utmTerm: 'term_test',
        src: 'src_test'
    }
};

// 2. Corrected/Standard payload structure (from UTMify documentation + validation feedback)
const newOrderData = {
    orderId: "test_new_" + Date.now(),
    platform: 'StudioAI',
    paymentMethod: 'pix',
    status: 'paid',
    createdAt: formatDate(new Date()), // YYYY-MM-DD HH:MM:SS
    approvedDate: formatDate(new Date()), // YYYY-MM-DD HH:MM:SS
    isTest: true,
    customer: {
        name: 'Cliente Teste Novo',
        email: 'teste_novo@exemplo.com',
        phone: '11999999999',
        document: '12345678909',
        country: 'BR'
    },
    products: [
        {
            id: 'premium_10',
            name: 'Pack 10 Fotos + 5 Brindes',
            planId: null,
            planName: null,
            quantity: 1,
            priceInCents: 8999
        }
    ],
    trackingParameters: {
        utm_source: 'src_test',
        utm_medium: 'med_test',
        utm_campaign: 'camp_test',
        utm_content: 'cont_test',
        utm_term: 'term_test',
        src: 'src_test'
    },
    commission: {
        totalPriceInCents: 8999,
        gatewayFeeInCents: 450, // Approx. 5%
        userCommissionInCents: 8549
    }
};

function sendRequest(payload, label) {
    return new Promise((resolve) => {
        const postData = JSON.stringify(payload);
        const options = {
            hostname: 'api.utmify.com.br',
            port: 443,
            path: '/api-credentials/orders',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-token': utmifyToken,
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        console.log(`\n--- Enviando payload [${label}] ---`);
        console.log('Payload:', postData);

        const req = https.request(options, (res) => {
            let dataStr = '';
            res.on('data', (chunk) => {
                dataStr += chunk;
            });
            res.on('end', () => {
                console.log(`Status HTTP para [${label}]:`, res.statusCode);
                console.log(`Resposta da API UTMify para [${label}]:`, dataStr);
                resolve({ status: res.statusCode, data: dataStr });
            });
        });

        req.on('error', (e) => {
            console.error(`Erro ao enviar [${label}]:`, e.message);
            resolve({ error: e.message });
        });

        req.write(postData);
        req.end();
    });
}

async function runTests() {
    console.log(`Iniciando testes com Token: ${utmifyToken.substring(0, 5)}...${utmifyToken.substring(utmifyToken.length - 5)}`);
    
    // Teste 1: Payload Antigo
    const resOld = await sendRequest(oldOrderData, 'Payload Atual de server.js');
    
    // Teste 2: Payload Novo / Corrigido
    const resNew = await sendRequest(newOrderData, 'Payload Corrigido / Documentado');
    
    console.log('\n--- FIM DOS TESTES ---');
}

runTests();
