const https = require('https');
require('dotenv').config();

const utmifyToken = process.env.UTMIFY_TOKEN;
if (!utmifyToken) throw new Error('Defina UTMIFY_TOKEN antes de executar este teste.');

// Format date helper: YYYY-MM-DD HH:MM:SS in UTC 0
function formatUTMifyDate(dateStr) {
    if (!dateStr) return new Date().toISOString().replace('T', ' ').substring(0, 19);
    try {
        const date = new Date(dateStr);
        const yyyy = date.getUTCFullYear();
        const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(date.getUTCDate()).padStart(2, '0');
        const hh = String(date.getUTCHours()).padStart(2, '0');
        const min = String(date.getUTCMinutes()).padStart(2, '0');
        const ss = String(date.getUTCSeconds()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
    } catch (e) {
        return new Date().toISOString().replace('T', ' ').substring(0, 19);
    }
}

// Mock payment object as returned by Mercado Pago SDK
const payment = {
    id: 9988776655,
    status: 'approved',
    payment_method_id: 'pix',
    payment_type_id: 'pix',
    date_created: new Date().toISOString(),
    date_approved: new Date().toISOString(),
    transaction_amount: 89.99,
    payer: {
        first_name: 'Kauê',
        last_name: 'Teste',
        email: 'kaue_teste@exemplo.com',
        phone: {
            number: '11999999999'
        },
        identification: {
            number: '12345678909'
        }
    },
    metadata: {
        package_id: 'premium_10',
        package_title: 'Pack 10 Fotos + 5 Brindes',
        package_price: '89.99',
        utm_source: 'src_val',
        utm_medium: 'med_val',
        utm_campaign: 'camp_val',
        utm_content: 'cont_val',
        utm_term: 'term_val',
        src: 'src_val'
    }
};

const paymentId = payment.id;

// Logic from server.js
const mpMethod = (payment.payment_method_id || '').toLowerCase();
const mpType = (payment.payment_type_id || '').toLowerCase();
let paymentMethod = 'unknown';

if (mpMethod === 'pix') {
    paymentMethod = 'pix';
} else if (mpMethod === 'boleto' || mpType === 'ticket') {
    paymentMethod = 'boleto';
} else if (mpType === 'credit_card' || mpType === 'debit_card' || mpMethod.includes('card')) {
    paymentMethod = 'credit_card';
} else if (mpMethod === 'paypal') {
    paymentMethod = 'paypal';
}

const priceInCents = Math.round((Number(payment.metadata?.package_price) || payment.transaction_amount || 29.99) * 100);
const gatewayFeeInCents = Math.round(priceInCents * 0.0499); // Taxa aproximada do Mercado Pago (4.99%)
const userCommissionInCents = priceInCents - gatewayFeeInCents;

const orderData = {
    orderId: paymentId.toString(),
    platform: 'StudioAI',
    paymentMethod: paymentMethod,
    status: 'paid',
    createdAt: formatUTMifyDate(payment.date_created),
    approvedDate: formatUTMifyDate(payment.date_approved),
    isTest: true,
    customer: {
        name: payment.payer?.first_name ? `${payment.payer.first_name} ${payment.payer.last_name || ''}`.trim() : 'Cliente',
        email: payment.payer?.email || 'email@exemplo.com',
        phone: payment.payer?.phone?.number || '',
        document: payment.payer?.identification?.number || '',
        country: 'BR'
    },
    products: [
        {
            id: payment.metadata?.package_id || 'premium',
            name: payment.metadata?.package_title || 'Ensaio Fotográfico por IA',
            planId: null,
            planName: null,
            quantity: 1,
            priceInCents: priceInCents
        }
    ],
    trackingParameters: {
        utm_source: payment.metadata?.utm_source || null,
        utm_medium: payment.metadata?.utm_medium || null,
        utm_campaign: payment.metadata?.utm_campaign || null,
        utm_content: payment.metadata?.utm_content || null,
        utm_term: payment.metadata?.utm_term || null,
        src: payment.metadata?.src || null
    },
    commission: {
        totalPriceInCents: priceInCents,
        gatewayFeeInCents: gatewayFeeInCents,
        userCommissionInCents: userCommissionInCents
    }
};

const postData = JSON.stringify(orderData);

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

console.log('Enviando Payload de validação...');
console.log(postData);

const reqPost = https.request(options, (resPost) => {
    let dataStr = '';
    resPost.on('data', (chunk) => {
        dataStr += chunk;
    });
    resPost.on('end', () => {
        console.log(`\nStatus HTTP: ${resPost.statusCode}`);
        console.log(`Retorno: ${dataStr}`);
        if (resPost.statusCode === 200 && JSON.parse(dataStr).OK === true) {
            console.log('\n✅ Integração Validada com Sucesso!');
        } else {
            console.error('\n❌ Erro na integração!');
        }
    });
});

reqPost.on('error', (e) => {
    console.error('Erro no envio:', e);
});

reqPost.write(postData);
reqPost.end();
