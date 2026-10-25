const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// REGRAS DE NEGÓCIO (LIMITES DE TEMPO)
const RATE_LIMIT_MS = 5 * 60 * 1000; // 5 minutos
const COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 horas

// BANCO DE DADOS EM MEMÓRIA (Separação estrita de módulos)
let estado = {
    catalogo: [], 
    filaPista: [],
    filaKaraoke: [],
    historicoPista: [], 
    ultimoPedidoPorUsuario: {}, 
    curtidas: {} 
};

io.on('connection', (socket) => {
    console.log(`Nova conexão no socket: ${socket.id}`);

    // Sincronização inicial para quem acabou de abrir o app
    socket.emit('estado_atualizado', {
        filaPista: estado.filaPista,
        filaKaraoke: estado.filaKaraoke,
        historicoPista: estado.historicoPista.slice(-10)
    });
    socket.emit('catalogo_atualizado', estado.catalogo);

    // Alimentação do catálogo vinda do script Python local
    socket.on('sync_catalogo', (dadosPython) => {
        estado.catalogo = dadosPython;
        io.emit('catalogo_atualizado', estado.catalogo);
    });

    // Fluxo de entrada: Módulo Pista
    socket.on('novo_pedido_pista', (pedido) => {
        const agora = Date.now();
        const idUsuario = pedido.pedinte; 
        
        const ultimoPedidoUser = estado.ultimoPedidoPorUsuario[idUsuario];
        if (ultimoPedidoUser && (agora - ultimoPedidoUser) < RATE_LIMIT_MS) {
            return socket.emit('erro_pedido', { msg: 'Aguarde 5 minutos entre pedidos.' });
        }

        const naFila = estado.filaPista.some(p => p.titulo === pedido.titulo && p.artista === pedido.artista);
        if (naFila) {
            return socket.emit('erro_pedido', { msg: 'Essa música já está na fila!' });
        }

        const tocouRecentemente = estado.historicoPista.some(p => {
            return p.titulo === pedido.titulo && 
                   p.artista === pedido.artista && 
                   (agora - p.timestamp_tocado) < COOLDOWN_MS;
        });
        
        if (tocouRecentemente) {
            return socket.emit('erro_pedido', { msg: 'Essa é sucesso e já tocou! Tente de novo mais tarde.' });
        }

        estado.ultimoPedidoPorUsuario[idUsuario] = agora;
        estado.filaPista.push(pedido);
        io.emit('fila_pista_atualizada', estado.filaPista);
    });

    // Fluxo de entrada: Módulo Karaokê (Rotas e memórias isoladas)
    socket.on('novo_pedido_karaoke', (pedido) => {
        estado.filaKaraoke.push(pedido);
        io.emit('fila_karaoke_atualizada', estado.filaKaraoke);
    });

    // Baixa de música executada (Trigger disparado pelo Python)
    socket.on('musica_tocada', (dados) => {
        estado.filaPista = estado.filaPista.filter(p => !(p.titulo === dados.titulo && p.artista === dados.artista));
        
        estado.historicoPista.push({
            ...dados,
            timestamp_tocado: Date.now()
        });

        io.emit('estado_atualizado', {
            filaPista: estado.filaPista,
            historicoPista: estado.historicoPista.slice(-10)
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`WebSockets rodando na porta ${PORT}`);
});
