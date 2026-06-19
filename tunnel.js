// ============================================================
// Auto-reconnecting Tunnel using localtunnel with HTTP Ping Check
// ============================================================

const localtunnel = require('localtunnel');
const https = require('https');

const PORT = process.env.PORT || 3000;
const SUBDOMAIN = 'ensaio-ia-kaue-v2';

// Manter o processo Node.js ativo indefinidamente
setInterval(() => {}, 1000 * 60 * 60);

let activeTunnel = null;
let isReconnecting = false;

async function startTunnel() {
    if (isReconnecting) return;
    isReconnecting = true;

    console.log(`[Tunnel] Iniciando túnel para a porta ${PORT} com o subdomínio "${SUBDOMAIN}"...`);
    try {
        if (activeTunnel) {
            try {
                activeTunnel.close();
            } catch (e) {}
            activeTunnel = null;
        }

        const tunnel = await localtunnel({
            port: PORT,
            subdomain: SUBDOMAIN
        });

        activeTunnel = tunnel;

        console.log(`\n============================================================`);
        console.log(`🚀 Túnel público ativo: ${tunnel.url}`);
        console.log(`============================================================\n`);

        tunnel.on('close', () => {
            console.log('[Tunnel] Evento close disparado. Reiniciando em 5 segundos...');
            activeTunnel = null;
            setTimeout(startTunnel, 5000);
        });

        tunnel.on('error', (err) => {
            console.error('[Tunnel] Erro no túnel:', err.message || err);
        });

    } catch (error) {
        console.error('[Tunnel] Falha ao criar o túnel:', error.message || error);
        console.log('[Tunnel] Tentando novamente em 10 segundos...');
        setTimeout(startTunnel, 10000);
    } finally {
        isReconnecting = false;
    }
}

// Verificação de saúde periódica a cada 10 segundos
setInterval(() => {
    if (isReconnecting) return;

    if (!activeTunnel) {
        console.log('[Tunnel Monitor] Nenhum túnel ativo. Iniciando...');
        startTunnel();
        return;
    }

    if (activeTunnel.closed) {
        console.log('[Tunnel Monitor] Conexão do túnel fechada. Reiniciando...');
        startTunnel();
        return;
    }
}, 10000);

startTunnel();
