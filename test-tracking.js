const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

const testRuntimeDir = path.join(__dirname, '.runtime-test');
process.env.RUNTIME_DATA_DIR = testRuntimeDir;

const { getPurchaseEventId, paymentTracking, runIdempotent, sendPurchaseToGtmServer } = require('./server');

async function main() {
    await fs.promises.rm(testRuntimeDir, { recursive: true, force: true });

    const successHtml = await fs.promises.readFile(path.join(__dirname, 'success.html'), 'utf8');
    assert.ok(!successHtml.includes('fallback_payment_id'), 'A página não pode fabricar um ID de compra');
    assert.ok(!successHtml.includes('firePurchaseEvent(null)'), 'A página não pode disparar Purchase sem pagamento');
    assert.ok(successHtml.includes("data.status !== 'approved'"), 'A aprovação do gateway deve ser obrigatória');
    assert.ok(successHtml.includes("'payment_id': String(payment.payment_id)"), 'O contrato deve expor payment_id');
    assert.ok(successHtml.includes("'event_id': eventId"), 'O contrato deve expor event_id determinístico');
    assert.ok(successHtml.includes("localStorage.getItem(storageKey)"), 'O navegador deve bloquear reenvio local');

    assert.strictEqual(getPurchaseEventId(12345), 'mp_12345');
    assert.deepStrictEqual(
        paymentTracking(
            { metadata: { utm_source: 'metadata', fbp: 'fbp-meta' } },
            { utms: { utm_source: 'saved', utm_campaign: 'campaign' }, fbc: 'fbc-saved' }
        ),
        {
            utm_source: 'saved',
            utm_medium: '',
            utm_campaign: 'campaign',
            utm_content: '',
            utm_term: '',
            src: '',
            fbp: 'fbp-meta',
            fbc: 'fbc-saved',
            ga_client_id: ''
        }
    );

    let executions = 0;
    const first = await runIdempotent('meta-gtm', 'mp_12345', async () => {
        executions += 1;
        return 'ok';
    });
    const second = await runIdempotent('meta-gtm', 'mp_12345', async () => {
        executions += 1;
        return 'should-not-run';
    });

    assert.strictEqual(first.status, 'sent');
    assert.strictEqual(second.status, 'already_sent');
    assert.strictEqual(executions, 1);

    let retries = 0;
    await assert.rejects(() => runIdempotent('utmify', 'mp_retry', async () => {
        retries += 1;
        throw new Error('temporary failure');
    }));
    const retry = await runIdempotent('utmify', 'mp_retry', async () => {
        retries += 1;
        return 'recovered';
    });
    assert.strictEqual(retry.status, 'sent');
    assert.strictEqual(retries, 2, 'Falha temporária deve permitir uma nova tentativa');

    let capturedRequest;
    const receiver = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            capturedRequest = { url: req.url, headers: req.headers, body };
            res.writeHead(204);
            res.end();
        });
    });
    await new Promise(resolve => receiver.listen(0, '127.0.0.1', resolve));
    const port = receiver.address().port;
    process.env.GTM_SERVER_URL = `http://127.0.0.1:${port}`;
    process.env.GA4_MEASUREMENT_ID = 'G-TEST123';

    await sendPurchaseToGtmServer({
        id: 98765,
        transaction_amount: 89.99,
        external_reference: 'order_test',
        metadata: { package_id: 'premium_10', package_title: 'Premium', package_price: '89.99' },
        payer: {
            email: 'cliente@example.com',
            first_name: 'Cliente',
            last_name: 'Teste',
            phone: { number: '5511999999999' }
        }
    }, {
        ga_client_id: '123.456',
        fbp: 'fb.1.123.456',
        fbc: 'fb.1.123.click',
        page_location: 'https://example.com/oferta',
        user_agent: 'Test Browser',
        client_ip: '203.0.113.10'
    });
    await new Promise(resolve => receiver.close(resolve));

    const receivedUrl = new URL(capturedRequest.url, `http://127.0.0.1:${port}`);
    const receivedBody = new URLSearchParams(capturedRequest.body);
    assert.strictEqual(receivedUrl.pathname, '/g/collect');
    assert.strictEqual(receivedUrl.searchParams.get('en'), 'purchase');
    assert.strictEqual(receivedBody.get('ep.event_id'), 'mp_98765');
    assert.strictEqual(receivedBody.get('ep.transaction_id'), '98765');
    assert.strictEqual(receivedBody.get('ep.x-fb-ck-fbp'), 'fb.1.123.456');
    assert.strictEqual(receivedBody.get('ep.x-fb-ud-em'), 'cliente@example.com');
    assert.strictEqual(capturedRequest.headers['x-forwarded-for'], '203.0.113.10');

    await fs.promises.rm(testRuntimeDir, { recursive: true, force: true });
    console.log('Tracking tests: OK');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
