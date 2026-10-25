const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

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
    if (target) {
        target.emit('estado_atualizado', payload);
    } else {
        io.emit('estado_atualizado', payload);
    }
}

io.on('connection', (socket) => {
    console.log(`Nova conexão: ${socket.id}`);
    emitirEstadoCompleto(socket);
    socket.emit('catalogo_atualizado', estado.catalogo);
    socket.emit('bridge_status', { online: estado.bridgeOnline });
    socket.emit('auto_status', { ativo: estado.autoAtivo });
    socket.emit('pausa_status', { pausado: estado.pausado });

    // === BRIDGE ===
    socket.on('registrar_bridge', () => {
        bridgeSocketId = socket.id;
        estado.bridgeOnline = true;
        io.emit('bridge_status', { online: true });
        console.log(`[BRIDGE] Online: ${socket.id}`);
    });

    socket.on('disconnect', () => {
        if (socket.id === bridgeSocketId) {
            bridgeSocketId = null;
            estado.bridgeOnline = false;
            io.emit('bridge_status', { online: false });
            console.log(`[BRIDGE] Offline.`);
        }
    });

    // === RESTAURAÇÃO DE BACKUP ===
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

    // === CATÁLOGO ===
    socket.on('sync_catalogo', (dados) => {
        estado.catalogo = dados;
        io.emit('catalogo_atualizado', dados);
    });

    socket.on('atualizar_deck_vdj', (deck) => {
        if (deck.proximas) estado.deckPista.proximas = deck.proximas;
        if (deck.tocandoAgora) estado.deckPista.tocandoAgora = deck.tocandoAgora;
        io.emit('deck_atualizado', estado.deckPista);
    });

    // === NOVOS PEDIDOS ===
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
        const tocouRecente = estado.historicoPista.some(p =>
            p.titulo === pedido.titulo && p.artista === pedido.artista && (agora - p.timestamp_tocado) < COOLDOWN_MS
        );
        if (tocouRecente) {
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

    // === MÚSICA TOCADA (via log do VDJ) ===
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

    // === AUTO STATUS ===
    socket.on('auto_status_atualizado', (data) => {
        estado.autoAtivo = data.ativo;
        io.emit('auto_status', { ativo: estado.autoAtivo });
    });

    // === INJEÇÃO RESULTADO ===
    socket.on('injecao_resultado', (resultado) => {
        io.emit('injecao_resultado', resultado);
    });

    // === AÇÕES DO ADMIN ===
    socket.on('admin_toggle_pausa', () => {
        estado.pausado = !estado.pausado;
        io.emit('pausa_status', { pausado: estado.pausado });
        emitirEstadoCompleto();
        console.log(`[ADMIN] Pausa: ${estado.pausado}`);
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
                artista: dados.artista
            });
        }
    });

    socket.on('admin_remover_pedido', (dados) => {
        const idx = estado.filaPista.findIndex(p => p.titulo === dados.titulo && p.artista === dados.artista);
        if (idx !== -1) {
            estado.filaPista.splice(idx, 1);
            io.emit('fila_pista_atualizada', estado.filaPista);
            emitirEstadoCompleto();
            console.log(`[ADMIN] Removido: ${dados.titulo}`);
        }
    });

    socket.on('admin_marcar_tocada', (dados) => {
        const idx = estado.filaPista.findIndex(p => p.titulo === dados.titulo && p.artista === dados.artista);
        if (idx !== -1) {
            const pedido = estado.filaPista.splice(idx, 1)[0];
            pedido.timestamp_tocado = Date.now();
            pedido.hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
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
            console.log(`[ADMIN] Banido: ${dados.nome}`);
        }
    });

    socket.on('admin_desbanir_usuario', (dados) => {
        estado.banidos = estado.banidos.filter(b => b !== dados.nome);
        io.emit('banidos_atualizados', estado.banidos);
        emitirEstadoCompleto();
    });

    socket.on('admin_enviar_comunicado', (dados) => {
        const comunicado = {
            id: Date.now(),
            texto: dados.texto,
            hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
            data: new Date().toLocaleDateString('pt-BR')
        };
        estado.comunicados.push(comunicado);
        io.emit('comunicado_recebido', comunicado);
        emitirEstadoCompleto();
        console.log(`[ADMIN] Comunicado: ${dados.texto}`);
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
        console.log(`[ADMIN] Evento RESETADO.`);
    });

    socket.on('admin_liberar_cooldown', (dados) => {
        estado.historicoPista = estado.historicoPista.filter(p =>
            !(p.titulo === dados.titulo && p.artista === dados.artista)
        );
        emitirEstadoCompleto();
        console.log(`[ADMIN] Cooldown liberado: ${dados.titulo}`);
    });

    // === ESTATÍSTICAS ===
    socket.on('admin_pedir_estatisticas', () => {
        const totalPedidos = estado.historicoPista.length + estado.filaPista.length;
        const totalTocados = estado.historicoPista.length;
        let tempoMedioEspera = 0;
        if (estado.historicoPista.length > 0) {
            const tempos = estado.historicoPista
                .filter(p => p.timestamp_tocado && p.timestamp_pedido)
                .map(p => p.timestamp_tocado - p.timestamp_pedido);
            if (tempos.length > 0) {
                tempoMedioEspera = Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length / 60000);
            }
        }
        const convidadosAtivos = [...new Set(estado.filaPista.concat(estado.historicoPista).map(p => p.pedinte))].length;
        socket.emit('estatisticas', {
            totalPedidos, totalTocados, tempoMedioEspera, convidadosAtivos,
            cooldownsAtivos: estado.historicoPista.length,
            banidos: estado.banidos.length
        });
    });

    socket.on('admin_pedir_cooldowns', () => {
        const agora = Date.now();
        const ativos = estado.historicoPista
            .filter(p => (agora - p.timestamp_tocado) < COOLDOWN_MS)
            .map(p => ({
                titulo: p.titulo,
                artista: p.artista,
                hora: p.hora,
                minutosRestantes: Math.round((COOLDOWN_MS - (agora - p.timestamp_tocado)) / 60000)
            }));
        socket.emit('cooldowns', ativos);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
