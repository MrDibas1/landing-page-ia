// ============================================================
// Server — Landing Page Ensaios Fotográficos por IA
// Backend mínimo para Mercado Pago Checkout Pro
// ============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MercadoPagoConfig, Preference } = require('mercadopago');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const RUNTIME_DIR = process.env.RUNTIME_DATA_DIR || path.join(__dirname, '.runtime');

// ============================================================
// Middleware
// ============================================================
app.use(cors());
app.use(express.json());

// Servir arquivos estáticos (HTML, CSS, JS, imagens)
app.use(express.static(path.join(__dirname)));

// ============================================================
// Mercado Pago — Configuração
// ============================================================
const mpClient = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN,
});

const preferenceClient = new Preference(mpClient);

function safeFilePart(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function ensureRuntimeDir(subdir) {
    const dir = path.join(RUNTIME_DIR, subdir);
    await fs.promises.mkdir(dir, { recursive: true });
    return dir;
}

function getRequestIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return String(forwarded).split(',')[0].trim();
    return req.ip || req.socket?.remoteAddress || '';
}

async function saveAttribution(externalReference, data) {
    const dir = await ensureRuntimeDir('attribution');
    const file = path.join(dir, `${safeFilePart(externalReference)}.json`);
    await fs.promises.writeFile(file, JSON.stringify(data), 'utf8');
}

async function loadAttribution(externalReference) {
    if (!externalReference) return {};
    try {
        const dir = await ensureRuntimeDir('attribution');
        const file = path.join(dir, `${safeFilePart(externalReference)}.json`);
        return JSON.parse(await fs.promises.readFile(file, 'utf8'));
    } catch (error) {
        if (error.code !== 'ENOENT') console.error('[Attribution] Erro ao carregar dados:', error.message);
        return {};
    }
}

async function runIdempotent(channel, eventId, task) {
    const dir = await ensureRuntimeDir('idempotency');
    const key = `${safeFilePart(channel)}-${safeFilePart(eventId)}`;
    const doneFile = path.join(dir, `${key}.done.json`);
    const lockFile = path.join(dir, `${key}.lock`);

    try {
        await fs.promises.access(doneFile);
        return { status: 'already_sent' };
    } catch (_) {
        // Ainda não concluído.
    }

    let lock;
    try {
        lock = await fs.promises.open(lockFile, 'wx');
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;

        const stat = await fs.promises.stat(lockFile).catch(() => null);
        const stale = stat && Date.now() - stat.mtimeMs > 10 * 60 * 1000;
        if (stale) {
            await fs.promises.unlink(lockFile).catch(() => {});
            return runIdempotent(channel, eventId, task);
        }
        return { status: 'processing' };
    }

    try {
        const result = await task();
        await fs.promises.writeFile(doneFile, JSON.stringify({
            eventId,
            channel,
            sentAt: new Date().toISOString()
        }), { encoding: 'utf8', flag: 'wx' }).catch(error => {
            if (error.code !== 'EEXIST') throw error;
        });
        return { status: 'sent', result };
    } finally {
        await lock.close().catch(() => {});
        await fs.promises.unlink(lockFile).catch(() => {});
    }
}

function requestRaw(urlString, { method = 'POST', headers = {}, body = '' } = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlString);
        const transport = require(url.protocol === 'https:' ? 'https' : 'http');
        const request = transport.request({
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: `${url.pathname}${url.search}`,
            method,
            headers
        }, response => {
            let responseBody = '';
            response.on('data', chunk => { responseBody += chunk; });
            response.on('end', () => {
                if (response.statusCode >= 200 && response.statusCode < 300) {
                    resolve({ statusCode: response.statusCode, body: responseBody });
                } else {
                    reject(new Error(`HTTP ${response.statusCode}: ${responseBody.slice(0, 500)}`));
                }
            });
        });
        request.on('error', reject);
        if (body) request.write(body);
        request.end();
    });
}

// ============================================================
// Endpoint: Criar Preferência de Pagamento
// ============================================================
app.post('/create-preference', async (req, res) => {
    try {
        const { packageId, title, price, utms, tracking } = req.body;

        // Tabela de preços oficiais no back-end para evitar spoofing/adulteração no front-end
        const packagePrices = {
            'basico_3': 29.99,
            'standard_5': 59.99,
            'premium_10': 89.99
        };

        const itemId = packageId || 'basico_3';
        const itemTitle = title || 'Ensaio Fotográfico Profissional por IA';
        // Enforça o preço correto com base no packageId ou usa o price/fallback se for um id desconhecido
        const itemPrice = packagePrices[itemId] || price || 29.99;

        const externalReference = `order_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
        const preferenceData = {
            items: [
                {
                    id: itemId,
                    title: itemTitle,
                    description: `Book digital profissional gerado por Inteligência Artificial. Pacote selecionado: ${itemTitle}.`,
                    quantity: 1,
                    unit_price: Number(itemPrice),
                    currency_id: 'BRL',
                    picture_url: 'https://i.imgur.com/placeholder.png',
                },
            ],
            // URLs de retorno
            back_urls: {
                success: `${process.env.SUCCESS_URL || 'http://localhost:3000/success.html'}?price=${itemPrice}`,
                failure: process.env.FAILURE_URL || 'http://localhost:3000',
                pending: process.env.PENDING_URL || 'http://localhost:3000',
            },
            auto_return: 'approved',
            // Configurações adicionais
            statement_descriptor: 'STUDIOAI ENSAIO',
            external_reference: externalReference,
            notification_url: process.env.WEBHOOK_URL || undefined,
            // Guardar parâmetros UTM de rastreamento no Mercado Pago para o UTMify
            metadata: {
                package_id: itemId,
                package_title: itemTitle,
                package_price: itemPrice.toString(),
                utm_source: utms?.utm_source || '',
                utm_medium: utms?.utm_medium || '',
                utm_campaign: utms?.utm_campaign || '',
                utm_content: utms?.utm_content || '',
                utm_term: utms?.utm_term || '',
                src: utms?.src || '',
                fbp: tracking?.fbp || '',
                fbc: tracking?.fbc || '',
                ga_client_id: tracking?.ga_client_id || '',
            },
            // Expiração (24 horas)
            expires: true,
            expiration_date_from: new Date().toISOString(),
            expiration_date_to: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        };

        const preference = await preferenceClient.create({ body: preferenceData });

        await saveAttribution(externalReference, {
            external_reference: externalReference,
            created_at: new Date().toISOString(),
            client_ip: getRequestIp(req),
            user_agent: req.headers['user-agent'] || '',
            page_location: tracking?.page_location || '',
            ga_client_id: tracking?.ga_client_id || '',
            fbp: tracking?.fbp || '',
            fbc: tracking?.fbc || '',
            utms: {
                utm_source: utms?.utm_source || '',
                utm_medium: utms?.utm_medium || '',
                utm_campaign: utms?.utm_campaign || '',
                utm_content: utms?.utm_content || '',
                utm_term: utms?.utm_term || '',
                src: utms?.src || ''
            }
        }).catch(error => {
            console.error('[Attribution] Não foi possível persistir os dados:', error.message);
        });
        console.log(`[Mercado Pago] Preferência criada para o item "${itemTitle}" (${itemId}) valor R$ ${itemPrice}:`, preference.id);

        res.json({
            id: preference.id,
            init_point: preference.init_point,
            sandbox_init_point: preference.sandbox_init_point,
            external_reference: externalReference,
        });
    } catch (error) {
        console.error('[Mercado Pago] Erro ao criar preferência:', error);
        res.status(500).json({
            error: 'Erro ao criar preferência de pagamento',
            details: error.message,
        });
    }
});

// Auxiliar: Formatar data para o padrão exigido pela UTMify (YYYY-MM-DD HH:MM:SS) em UTC 0
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

// O webhook antigo foi removido. A implementação abaixo é a única rota de compra.

function getPurchaseEventId(paymentId) {
    return `mp_${String(paymentId)}`;
}

function paymentTracking(payment, attribution) {
    const metadata = payment.metadata || {};
    const savedUtms = attribution.utms || {};
    return {
        utm_source: savedUtms.utm_source || metadata.utm_source || '',
        utm_medium: savedUtms.utm_medium || metadata.utm_medium || '',
        utm_campaign: savedUtms.utm_campaign || metadata.utm_campaign || '',
        utm_content: savedUtms.utm_content || metadata.utm_content || '',
        utm_term: savedUtms.utm_term || metadata.utm_term || '',
        src: savedUtms.src || metadata.src || '',
        fbp: attribution.fbp || metadata.fbp || '',
        fbc: attribution.fbc || metadata.fbc || '',
        ga_client_id: attribution.ga_client_id || metadata.ga_client_id || ''
    };
}

async function sendUtmifySale(payment, attribution) {
    const token = process.env.UTMIFY_TOKEN;
    if (!token) throw new Error('UTMIFY_TOKEN não configurado');

    const metadata = payment.metadata || {};
    const tracking = paymentTracking(payment, attribution);
    const totalInCents = Math.round((Number(metadata.package_price) || payment.transaction_amount || 0) * 100);
    const gatewayFeeInCents = Math.round(totalInCents * 0.0499);
    const method = String(payment.payment_method_id || '').toLowerCase();
    const type = String(payment.payment_type_id || '').toLowerCase();
    let paymentMethod = 'unknown';
    if (method === 'pix') paymentMethod = 'pix';
    else if (method === 'boleto' || type === 'ticket') paymentMethod = 'boleto';
    else if (type === 'credit_card' || type === 'debit_card' || method.includes('card')) paymentMethod = 'credit_card';
    else if (method === 'paypal') paymentMethod = 'paypal';

    const order = {
        orderId: String(payment.id),
        platform: 'StudioAI',
        paymentMethod,
        status: 'paid',
        createdAt: formatUTMifyDate(payment.date_created),
        approvedDate: formatUTMifyDate(payment.date_approved),
        isTest: process.env.UTMIFY_IS_TEST === 'true',
        customer: {
            name: `${payment.payer?.first_name || ''} ${payment.payer?.last_name || ''}`.trim() || 'Cliente',
            email: payment.payer?.email || '',
            phone: payment.payer?.phone?.number || '',
            document: payment.payer?.identification?.number || '',
            country: 'BR'
        },
        products: [{
            id: metadata.package_id || 'premium',
            name: metadata.package_title || 'Ensaio Fotográfico por IA',
            planId: null,
            planName: null,
            quantity: 1,
            priceInCents: totalInCents
        }],
        trackingParameters: {
            utm_source: tracking.utm_source || null,
            utm_medium: tracking.utm_medium || null,
            utm_campaign: tracking.utm_campaign || null,
            utm_content: tracking.utm_content || null,
            utm_term: tracking.utm_term || null,
            src: tracking.src || null
        },
        commission: {
            totalPriceInCents: totalInCents,
            gatewayFeeInCents,
            userCommissionInCents: totalInCents - gatewayFeeInCents
        }
    };

    const body = JSON.stringify(order);
    return requestRaw('https://api.utmify.com.br/api-credentials/orders', {
        headers: {
            'Content-Type': 'application/json',
            'x-api-token': token,
            'Content-Length': Buffer.byteLength(body)
        },
        body
    });
}

async function sendPurchaseToGtmServer(payment, attribution) {
    const baseUrl = process.env.GTM_SERVER_URL;
    if (!baseUrl) throw new Error('GTM_SERVER_URL não configurado');

    const metadata = payment.metadata || {};
    const tracking = paymentTracking(payment, attribution);
    const eventId = getPurchaseEventId(payment.id);
    const endpoint = new URL('/g/collect', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    endpoint.searchParams.set('v', '2');
    endpoint.searchParams.set('tid', process.env.GA4_MEASUREMENT_ID || 'G-JHS074JGZM');
    endpoint.searchParams.set('cid', tracking.ga_client_id || String(payment.id));
    endpoint.searchParams.set('en', 'purchase');
    if (attribution.page_location) endpoint.searchParams.set('dl', attribution.page_location);

    const params = new URLSearchParams();
    params.set('ep.event_id', eventId);
    params.set('ep.transaction_id', String(payment.id));
    params.set('ep.payment_id', String(payment.id));
    params.set('ep.currency', 'BRL');
    params.set('epn.value', String(Number(metadata.package_price) || payment.transaction_amount || 0));
    params.set('ep.package_id', metadata.package_id || 'premium');
    params.set('ep.package_title', metadata.package_title || 'Ensaio Fotográfico por IA');
    if (tracking.fbp) params.set('ep.x-fb-ck-fbp', tracking.fbp);
    if (tracking.fbc) params.set('ep.x-fb-ck-fbc', tracking.fbc);
    if (tracking.utm_source) params.set('ep.utm_source', tracking.utm_source);
    if (tracking.utm_medium) params.set('ep.utm_medium', tracking.utm_medium);
    if (tracking.utm_campaign) params.set('ep.utm_campaign', tracking.utm_campaign);
    if (tracking.utm_content) params.set('ep.utm_content', tracking.utm_content);
    if (tracking.utm_term) params.set('ep.utm_term', tracking.utm_term);
    if (payment.payer?.email) params.set('ep.x-fb-ud-em', payment.payer.email);
    if (payment.payer?.phone?.number) params.set('ep.x-fb-ud-ph', payment.payer.phone.number);
    if (payment.payer?.first_name) params.set('ep.x-fb-ud-fn', payment.payer.first_name);
    if (payment.payer?.last_name) params.set('ep.x-fb-ud-ln', payment.payer.last_name);
    params.set('ep.x-fb-cd-content_ids', metadata.package_id || 'premium');
    params.set('ep.x-fb-cd-content_name', metadata.package_title || 'Ensaio Fotográfico por IA');
    params.set('ep.x-fb-cd-content_type', 'product');

    const body = params.toString();
    const headers = {
        'Content-Type': 'text/plain;charset=UTF-8',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': attribution.user_agent || 'StudioAI-MercadoPago-Webhook/1.0'
    };
    if (attribution.client_ip) headers['X-Forwarded-For'] = attribution.client_ip;

    return requestRaw(endpoint.toString(), { headers, body });
}

// Webhook oficial: somente pagamento aprovado gera Purchase.
app.post('/webhook', async (req, res) => {
    const { action, type, data } = req.body || {};
    const eventType = type || action;
    const isPaymentEvent = eventType === 'payment' || eventType === 'payment.updated' || action === 'payment.created';
    if (!isPaymentEvent || !data?.id) return res.sendStatus(200);

    try {
        const { Payment } = require('mercadopago');
        const payment = await new Payment(mpClient).get({ id: data.id });
        if (payment.status !== 'approved') {
            console.log(`[Webhook] Pagamento ${data.id} ignorado com status ${payment.status}`);
            return res.sendStatus(200);
        }

        const attribution = await loadAttribution(payment.external_reference);
        const eventId = getPurchaseEventId(payment.id);
        const deliveries = await Promise.allSettled([
            runIdempotent('utmify', eventId, () => sendUtmifySale(payment, attribution)),
            runIdempotent('meta-gtm', eventId, () => sendPurchaseToGtmServer(payment, attribution))
        ]);
        const failures = deliveries.filter(result => result.status === 'rejected');
        if (failures.length) {
            failures.forEach(result => console.error('[Webhook] Falha de entrega:', result.reason?.message));
            return res.sendStatus(500);
        }

        console.log(`[Webhook] Purchase ${eventId} processado com idempotência.`, deliveries.map(item => item.value?.status));
        return res.sendStatus(200);
    } catch (error) {
        console.error('[Webhook] Erro ao validar/processar pagamento:', error.message);
        return res.sendStatus(500);
    }
});

// ============================================================
// Endpoint: Obter detalhes simplificados do pagamento aprovado (para front-end)
// ============================================================
app.get('/payment-details/:id', async (req, res) => {
    const paymentId = req.params.id;
    if (!paymentId) {
        return res.status(400).json({ error: 'ID do pagamento não fornecido' });
    }

    try {
        const { Payment } = require('mercadopago');
        const paymentClient = new Payment(mpClient);
        const payment = await paymentClient.get({ id: paymentId });

        // Permitir apenas pagamentos aprovados por motivos de privacidade/segurança
        if (payment.status !== 'approved') {
            return res.status(400).json({ error: 'Pagamento não está aprovado' });
        }

        // Extrair dados do comprador
        const first_name = payment.payer?.first_name || '';
        const last_name = payment.payer?.last_name || '';
        const email = payment.payer?.email || '';

        // Formatar telefone (código do país + DDD + número)
        let phone = payment.payer?.phone?.number || '';
        const areaCode = payment.payer?.phone?.area_code || '';
        if (areaCode && phone && !phone.includes(areaCode)) {
            phone = `${areaCode}${phone}`;
        }
        phone = phone.replace(/\D/g, ''); // Remover caracteres não numéricos
        if (phone) {
            if (!phone.startsWith('55') && phone.length <= 11) {
                phone = `+55${phone}`;
            } else if (!phone.startsWith('+')) {
                phone = `+${phone}`;
            }
        }

        const price = payment.transaction_amount || Number(payment.metadata?.package_price) || 29.99;
        const package_id = payment.metadata?.package_id || 'ensaio-fotografico-ia';
        const package_title = payment.metadata?.package_title || 'Ensaio Fotográfico por IA';

        res.json({
            payment_id: paymentId,
            event_id: getPurchaseEventId(paymentId),
            transaction_id: paymentId,
            external_reference: payment.external_reference || '',
            status: payment.status,
            value: price,
            package_id: package_id,
            package_title: package_title,
            user_data: {
                email: email,
                phone: phone,
                first_name: first_name,
                last_name: last_name
            }
        });
    } catch (error) {
        console.error(`[Server] Erro ao buscar detalhes do pagamento ${paymentId}:`, error);
        res.status(500).json({ error: 'Erro ao buscar detalhes do pagamento', details: error.message });
    }
});

// ============================================================
// Health check
// ============================================================
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        mp_configured: !!process.env.MP_ACCESS_TOKEN && process.env.MP_ACCESS_TOKEN !== 'SEU_ACCESS_TOKEN_AQUI',
    });
});

// ============================================================
// Start
// ============================================================
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`\n🚀 Servidor rodando em http://localhost:${PORT}`);
        console.log(`📸 Landing page: http://localhost:${PORT}/index.html`);
        console.log(`💳 Mercado Pago configurado: ${!!process.env.MP_ACCESS_TOKEN && process.env.MP_ACCESS_TOKEN !== 'SEU_ACCESS_TOKEN_AQUI'}\n`);
    });
}

module.exports = {
    app,
    getPurchaseEventId,
    paymentTracking,
    runIdempotent,
    sendPurchaseToGtmServer,
    sendUtmifySale
};
