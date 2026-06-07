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

        // Definir valores padrão caso não sejam enviados (retrocompatibilidade)
        const itemTitle = title || 'Ensaio Fotográfico Profissional por IA';
        const itemPrice = price || 97;
        const itemId = packageId || 'ensaio-fotografico-ia';

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

                    const priceInCents = Math.round((Number(payment.metadata?.package_price) || payment.transaction_amount || 97) * 100);

                    const orderData = {
                        orderId: paymentId.toString(),
                        platform: 'StudioAI',
                        paymentMethod: paymentMethod,
                        status: 'paid',
                        createdAt: payment.date_created || new Date().toISOString(),
                        approvedDate: payment.date_approved || new Date().toISOString(),
                        customer: {
                            name: payment.payer?.first_name ? `${payment.payer.first_name} ${payment.payer.last_name || ''}`.trim() : 'Cliente',
                            email: payment.payer?.email || 'email@exemplo.com',
                            phone: payment.payer?.phone?.number || '',
                            document: payment.payer?.identification?.number || '',
                            country: 'BR',
                            ip: req.ip || '0.0.0.0'
                        },
                        products: [
                            {
                                id: payment.metadata?.package_id || 'ensaio-fotografico-ia',
                                name: payment.metadata?.package_title || 'Ensaio Fotográfico por IA',
                                planId: payment.metadata?.package_id || 'ensaio-fotografico-ia',
                                planName: payment.metadata?.package_title || 'Ensaio Fotográfico por IA',
                                quantity: 1,
                                priceInCents: priceInCents
                            }
                        ],
                        trackingParameters: {
                            utm_source: payment.metadata?.utm_source || '',
                            utm_campaign: payment.metadata?.utm_campaign || '',
                            utm_medium: payment.metadata?.utm_medium || '',
                            utm_content: payment.metadata?.utm_content || '',
                            utm_term: payment.metadata?.utm_term || '',
                            src: payment.metadata?.src || ''
                        },
                        commission: {
                            totalPriceInCents: priceInCents,
                            gatewayFeeInCents: 0,
                            userCommissionInCents: priceInCents,
                            currency: 'BRL'
                        },
                        isTest: payment.live_mode === false
                    };

                    // Fazer o POST para a UTMify (usando fetch nativo do Node.js 24)
                    const response = await fetch('https://api.utmify.com.br/api-credentials/orders', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-api-token': utmifyToken
                        },
                        body: JSON.stringify(orderData)
                    });

                    const responseText = await response.text();
                    console.log(`[UTMify] Envio concluído. Status: ${response.status}. Retorno:`, responseText);
                }
            } catch (error) {
                console.error('[Webhook] Erro ao integrar com UTMify:', error);
            }
        }
    }

    res.sendStatus(200);
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
