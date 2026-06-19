// ============================================================
// Server — Landing Page Ensaios Fotográficos por IA
// Backend mínimo para Mercado Pago Checkout Pro
// ============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MercadoPagoConfig, Preference } = require('mercadopago');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

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

// ============================================================
// Endpoint: Criar Preferência de Pagamento
// ============================================================
app.post('/create-preference', async (req, res) => {
    try {
        const { packageId, title, price, utms } = req.body;

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
            external_reference: `order_${Date.now()}`,
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
            },
            // Expiração (24 horas)
            expires: true,
            expiration_date_from: new Date().toISOString(),
            expiration_date_to: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        };

        const preference = await preferenceClient.create({ body: preferenceData });
        console.log(`[Mercado Pago] Preferência criada para o item "${itemTitle}" (${itemId}) valor R$ ${itemPrice}:`, preference.id);

        res.json({
            id: preference.id,
            init_point: preference.init_point,
            sandbox_init_point: preference.sandbox_init_point,
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

// ============================================================
// Endpoint: Webhook (para notificações do Mercado Pago)
// ============================================================
app.post('/webhook', async (req, res) => {
    const { action, type, data } = req.body;
    console.log('[Webhook] Notificação recebida:', type || action, data);

    const eventType = type || action;

    // Se for um evento de pagamento
    if (eventType === 'payment' || eventType === 'payment.updated' || action === 'payment.created') {
        const paymentId = data?.id || req.body.data?.id;
        if (paymentId) {
            try {
                // Instanciar o cliente de pagamento do Mercado Pago para buscar detalhes
                const { Payment } = require('mercadopago');
                const paymentClient = new Payment(mpClient);

                // Buscar detalhes do pagamento no Mercado Pago
                const payment = await paymentClient.get({ id: paymentId });
                console.log(`[Webhook] Pagamento ${paymentId} status: ${payment.status}`);

                // Se o pagamento foi aprovado, enviar para a UTMify
                if (payment.status === 'approved') {
                    console.log(`[Webhook] Pagamento ${paymentId} aprovado! Enviando para o UTMify...`);
                    const utmifyToken = process.env.UTMIFY_TOKEN || 'JBzJB6WK1VTtEFv8rYtkflNbxkCABpytA6T0';
                    
                    // Mapear o método de pagamento para os valores aceitos pela UTMify
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
                        isTest: process.env.UTMIFY_IS_TEST === 'true',
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

                    // Fazer o POST para a UTMify usando o módulo nativo https para compatibilidade universal
                    const https = require('https');
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

                    const reqPost = https.request(options, (resPost) => {
                        let dataStr = '';
                        resPost.on('data', (chunk) => {
                            dataStr += chunk;
                        });
                        resPost.on('end', () => {
                            console.log(`[UTMify] Envio concluído. Status: ${resPost.statusCode}. Retorno:`, dataStr);
                        });
                    });

                    reqPost.on('error', (e) => {
                        console.error('[UTMify] Erro no envio:', e);
                    });

                    reqPost.write(postData);
                    reqPost.end();

                    // Enviar para o GTM Server-Side se a URL estiver configurada
                    const gtmServerUrl = process.env.GTM_SERVER_URL;
                    if (gtmServerUrl) {
                        console.log(`[GTM Server] Enviando evento de compra para ${gtmServerUrl}/event...`);
                        
                        const gtmEventData = {
                            event_name: 'purchase',
                            event_id: paymentId.toString(),
                            client_id: paymentId.toString(),
                            user_data: {
                                email: payment.payer?.email || '',
                                phone: payment.payer?.phone?.number || '',
                                first_name: payment.payer?.first_name || '',
                                last_name: payment.payer?.last_name || '',
                                cpf: payment.payer?.identification?.number || ''
                            },
                            custom_data: {
                                value: Number(payment.metadata?.package_price) || payment.transaction_amount || 29.99,
                                currency: 'BRL',
                                payment_method: paymentMethod,
                                package_id: payment.metadata?.package_id || 'premium',
                                package_title: payment.metadata?.package_title || 'Ensaio Fotográfico por IA'
                            },
                            utms: {
                                utm_source: payment.metadata?.utm_source || '',
                                utm_medium: payment.metadata?.utm_medium || '',
                                utm_campaign: payment.metadata?.utm_campaign || '',
                                utm_content: payment.metadata?.utm_content || '',
                                utm_term: payment.metadata?.utm_term || '',
                                src: payment.metadata?.src || ''
                            }
                        };

                        const gtmPostData = JSON.stringify(gtmEventData);
                        
                        try {
                            const url = new URL(gtmServerUrl);
                            const gtmOptions = {
                                hostname: url.hostname,
                                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                                path: '/event',
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Content-Length': Buffer.byteLength(gtmPostData)
                                }
                            };

                            const gtmHttps = require(url.protocol === 'https:' ? 'https' : 'http');
                            const reqGtm = gtmHttps.request(gtmOptions, (resGtm) => {
                                let gtmResponse = '';
                                resGtm.on('data', (chunk) => {
                                    gtmResponse += chunk;
                                });
                                resGtm.on('end', () => {
                                    console.log(`[GTM Server] Evento enviado com sucesso. Status: ${resGtm.statusCode}`);
                                });
                            });

                            reqGtm.on('error', (err) => {
                                console.error('[GTM Server] Erro ao enviar evento:', err.message);
                            });

                            reqGtm.write(gtmPostData);
                            reqGtm.end();
                        } catch (urlErr) {
                            console.error('[GTM Server] Erro ao processar URL do GTM Server:', urlErr.message);
                        }
                    }
                }
            } catch (error) {
                console.error('[Webhook] Erro ao processar notificação de pagamento:', error);
            }
        }
    }

    res.sendStatus(200);
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

        res.json({
            payment_id: paymentId,
            value: price,
            package_id: package_id,
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
app.listen(PORT, () => {
    console.log(`\n🚀 Servidor rodando em http://localhost:${PORT}`);
    console.log(`📸 Landing page: http://localhost:${PORT}/index.html`);
    console.log(`💳 Mercado Pago configurado: ${!!process.env.MP_ACCESS_TOKEN && process.env.MP_ACCESS_TOKEN !== 'SEU_ACCESS_TOKEN_AQUI'}\n`);
});
