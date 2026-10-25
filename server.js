const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, { 
    cors: { origin: "*" },
    maxHttpBufferSize: 10 * 1024 * 1024,
    pingInterval: 25000,
    pingTimeout: 60000
});

app.use(express.static('public'));

const COOLDOWN_MS = 2 * 60 * 60 * 1000;

let estado = {
    catalogo: [],
    filaPista: [],
    filaKaraoke: [],
    historicoPista: [],
    deckPista: { tocandoAgora: null, proximas: [] },
    curtidas: {},
    bridgeOnline: false,
    pausado: false,
    autoAtivo: false,
    banidos: [],
    comunicados: []
};

let bridgeSocketId = null;

// CORREÇÃO: Função central para gerar horário no fuso de Brasília
function horaBrasilia() {
    return new Date().toLocaleTimeString('pt-BR', { 
        hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' 
    });
}
function dataBrasilia() {
    return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function emitirEstadoCompleto(target) {
    const payload = {
        filaPista: estado.filaPista,
        filaKaraoke: estado.filaKaraoke,
        historicoPista: estado.historicoPista.slice(-100),
        deckPista: estado.deckPista,
        bridgeOnline: estado.bridgeOnline,
        pausado: estado.pausado,
        autoAtivo: estado.autoAtivo,
        banidos: estado.banidos,
        comunicados: estado.comunicados.slice(-50)
    };
    if (target) target.emit('estado_atualizado', payload);
    else io.emit('estado_atualizado', payload);
}

io.on('connection', (socket) => {
    console.log(`Nova conexão: ${socket.id}`);
    emitirEstadoCompleto(socket);
    socket.emit('catalogo_atualizado', estado.catalogo);
    socket.emit('bridge_status', { online: estado.bridgeOnline });
    socket.emit('auto_status', { ativo: estado.autoAtivo });
    socket.emit('pausa_status', { pausado: estado.pausado });

    socket.on('registrar_bridge', () => {
        bridgeSocketId = socket.id;
        estado.bridgeOnline = true;
        io.emit('bridge_status', { online: true });
        console.log(`[BRIDGE] Online: ${socket.id}`);
    });

    socket.on('disconnect', (reason) => {
        if (socket.id === bridgeSocketId) {
            console.log(`[BRIDGE] Desconectado. Motivo: ${reason}`);
            bridgeSocketId = null;
            estado.bridgeOnline = false;
            io.emit('bridge_status', { online: false });
        }
    });

    socket.on('restaurar_estado', (backup) => {
        const vazio = estado.filaPista.length === 0 && estado.filaKaraoke.length === 0 && estado.historicoPista.length === 0;
        if (vazio) {
            estado.filaPista = backup.filaPista || [];
            estado.filaKaraoke = backup.filaKaraoke || [];
            estado.historicoPista = backup.historicoPista || [];
            estado.comunicados = backup.comunicados || [];
            estado.banidos = backup.banidos || [];
            estado.pausado = backup.pausado || false;
            console.log(`[BACKUP] Restaurado: ${estado.filaPista.length} pista, ${estado.filaKaraoke.length} karaokê.`);
            emitirEstadoCompleto();
            io.emit('pausa_status', { pausado: estado.pausado });
        } else {
            console.log(`[BACKUP] Ignorado (servidor já tem dados).`);
        }
    });

    socket.on('sync_catalogo', (dados) => {
        estado.catalogo = dados;
        io.emit('catalogo_atualizado', dados);
        console.log(`[CATALOGO] Recebido: ${dados.length} itens`);
    });

    socket.on('atualizar_deck_vdj', (deck) => {
        if (deck.proximas) estado.deckPista.proximas = deck.proximas;
        if (deck.tocandoAgora) estado.deckPista.tocandoAgora = deck.tocandoAgora;
        io.emit('deck_atualizado', estado.deckPista);
    });

    socket.on('caminho_resolvido', (dados) => {
        const pedido = estado.filaPista.find(p =>
            p.titulo === dados.titulo &&
            p.artista === dados.artista &&
            (p.timestamp_pedido || 0) === (dados.timestamp_pedido || 0)
        );
        if (pedido) {
            pedido.caminho = dados.caminho;
            io.emit('fila_pista_atualizada', estado.filaPista);
        }
    });

    socket.on('novo_pedido_pista', (pedido) => {
        const agora = Date.now();
        const nomeUser = (pedido.pedinte || '').toLowerCase();
        if (estado.banidos.some(b => b.toLowerCase() === nomeUser)) {
            return socket.emit('erro_pedido', { msg: 'Você foi removido do evento.' });
        }
        if (estado.pausado) {
            return socket.emit('erro_pedido', { msg: 'A pista está fechada no momento.' });
        }
        if (estado.filaPista.some(p => p.titulo === pedido.titulo && p.artista === pedido.artista)) {
            return socket.emit('erro_pedido', { msg: 'Essa música já está na fila!' });
        }
        const recente = estado.historicoPista.some(p =>
            p.titulo === pedido.titulo && p.artista === pedido.artista && (agora - p.timestamp_tocado) < COOLDOWN_MS
        );
        if (recente) {
            return socket.emit('erro_pedido', { msg: 'Essa música já tocou há menos de 2h.' });
        }
        estado.filaPista.push(pedido);
        io.emit('fila_pista_atualizada', estado.filaPista);
        emitirEstadoCompleto();
    });

    socket.on('novo_pedido_karaoke', (pedido) => {
        const nomeUser = (pedido.pedinte || '').toLowerCase();
        if (estado.banidos.some(b => b.toLowerCase() === nomeUser)) {
            return socket.emit('erro_pedido', { msg: 'Você foi removido do evento.' });
        }
        estado.filaKaraoke.push(pedido);
        io.emit('fila_karaoke_atualizada', estado.filaKaraoke);
        emitirEstadoCompleto();
    });

    socket.on('musica_tocada', (dados) => {
        const idx = estado.filaPista.findIndex(p =>
            p.titulo.toLowerCase().includes(dados.titulo.toLowerCase()) ||
            dados.titulo.toLowerCase().includes(p.titulo.toLowerCase())
        );
        if (idx !== -1) {
            const pedido = estado.filaPista.splice(idx, 1)[0];
            pedido.timestamp_tocado = Date.now();
            pedido.hora = dados.hora;
            estado.historicoPista.push(pedido);
        }
        estado.deckPista.tocandoAgora = {
            titulo: dados.titulo, artista: dados.artista,
            capa: dados.capa || "https://vdj-requests-cloud.onrender.com/capa-virtualdj.png"
        };
        emitirEstadoCompleto();
    });

    socket.on('auto_status_atualizado', (data) => {
        estado.autoAtivo = data.ativo;
        io.emit('auto_status', { ativo: estado.autoAtivo });
    });

    socket.on('injecao_resultado', (r) => { io.emit('injecao_resultado', r); });

    socket.on('admin_toggle_pausa', () => {
        estado.pausado = !estado.pausado;
        io.emit('pausa_status', { pausado: estado.pausado });
        emitirEstadoCompleto();
    });

    socket.on('admin_toggle_auto', () => {
        const acao = estado.autoAtivo ? 'auto_off' : 'auto_on';
        io.to(bridgeSocketId).emit('comando_admin', { action: acao });
    });

    socket.on('admin_forcar_injecao', (dados) => {
        if (bridgeSocketId) {
            io.to(bridgeSocketId).emit('comando_admin', {
                action: 'forcar_injecao',
                titulo: dados.titulo,
                artista: dados.artista,
                caminho: dados.caminho || ''
            });
        }
    });

    socket.on('admin_remover_pedido', (dados) => {
        const idx = estado.filaPista.findIndex(p => p.titulo === dados.titulo && p.artista === dados.artista);
        if (idx !== -1) {
            estado.filaPista.splice(idx, 1);
            io.emit('fila_pista_atualizada', estado.filaPista);
            emitirEstadoCompleto();
        }
    });

    socket.on('admin_marcar_tocada', (dados) => {
        const idx = estado.filaPista.findIndex(p => p.titulo === dados.titulo && p.artista === dados.artista);
        if (idx !== -1) {
            const pedido = estado.filaPista.splice(idx, 1)[0];
            pedido.timestamp_tocado = Date.now();
            // CORREÇÃO: usa hora de Brasília
            pedido.hora = horaBrasilia();
            estado.historicoPista.push(pedido);
            io.emit('fila_pista_atualizada', estado.filaPista);
            emitirEstadoCompleto();
        }
    });

    socket.on('admin_banir_usuario', (dados) => {
        if (!estado.banidos.includes(dados.nome)) {
            estado.banidos.push(dados.nome);
            io.emit('banidos_atualizados', estado.banidos);
            emitirEstadoCompleto();
        }
    });

    socket.on('admin_desbanir_usuario', (dados) => {
        estado.banidos = estado.banidos.filter(b => b !== dados.nome);
        io.emit('banidos_atualizados', estado.banidos);
        emitirEstadoCompleto();
    });

    socket.on('admin_enviar_comunicado', (dados) => {
        // CORREÇÃO: usa hora e data de Brasília
        const c = {
            id: Date.now(),
            texto: dados.texto,
            hora: horaBrasilia(),
            data: dataBrasilia()
        };
        estado.comunicados.push(c);
        io.emit('comunicado_recebido', c);
        emitirEstadoCompleto();
    });

    socket.on('admin_reset_evento', () => {
        estado.filaPista = [];
        estado.filaKaraoke = [];
        estado.historicoPista = [];
        estado.comunicados = [];
        estado.banidos = [];
        estado.pausado = false;
        io.emit('fila_pista_atualizada', []);
        io.emit('fila_karaoke_atualizada', []);
        io.emit('pausa_status', { pausado: false });
        emitirEstadoCompleto();
    });

    socket.on('admin_liberar_cooldown', (dados) => {
        estado.historicoPista = estado.historicoPista.filter(p =>
            !(p.titulo === dados.titulo && p.artista === dados.artista)
        );
        emitirEstadoCompleto();
    });

    socket.on('admin_pedir_estatisticas', () => {
        const totalPedidos = estado.historicoPista.length + estado.filaPista.length;
        const totalTocados = estado.historicoPista.length;
        let tempoMedio = 0;
        if (estado.historicoPista.length > 0) {
            const tempos = estado.historicoPista
                .filter(p => p.timestamp_tocado && p.timestamp_pedido)
                .map(p => p.timestamp_tocado - p.timestamp_pedido);
            if (tempos.length > 0) tempoMedio = Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length / 60000);
        }
        const convidados = [...new Set(estado.filaPista.concat(estado.historicoPista).map(p => p.pedinte))].length;
        socket.emit('estatisticas', {
            totalPedidos, totalTocados, tempoMedioEspera: tempoMedio, convidadosAtivos: convidados,
            cooldownsAtivos: estado.historicoPista.length, banidos: estado.banidos.length
        });
    });

    socket.on('admin_pedir_cooldowns', () => {
        const agora = Date.now();
        const ativos = estado.historicoPista
            .filter(p => (agora - p.timestamp_tocado) < COOLDOWN_MS)
            .map(p => ({
                titulo: p.titulo, artista: p.artista, hora: p.hora,
                minutosRestantes: Math.round((COOLDOWN_MS - (agora - p.timestamp_tocado)) / 60000)
            }));
        socket.emit('cooldowns', ativos);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
