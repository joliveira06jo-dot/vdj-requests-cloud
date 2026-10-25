const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));

// REGRAS DE NEGÓCIO (Apenas Cooldown de 2 horas)
const COOLDOWN_MS = 2 * 60 * 60 * 1000; 

// BANCO DE DADOS EM MEMÓRIA
let estado = {
    catalogo: [], 
    filaPista: [],
    filaKaraoke: [],
    historicoPista: [], 
    deckPista: { tocandoAgora: null, proximas: [] }, // Novo: Dados reais do VirtualDJ
    curtidas: {} 
};

io.on('connection', (socket) => {
    console.log(`Nova conexão: ${socket.id}`);

    // Sincronização inicial (envia tudo que tem)
    socket.emit('estado_atualizado', {
        filaPista: estado.filaPista,
        filaKaraoke: estado.filaKaraoke,
        historicoPista: estado.historicoPista.slice(-10),
        deckPista: estado.deckPista
    });
    socket.emit('catalogo_atualizado', estado.catalogo);

    // Recebe o catálogo do Python
    socket.on('sync_catalogo', (dadosPython) => {
        estado.catalogo = dadosPython;
        io.emit('catalogo_atualizado', estado.catalogo);
    });

    // Recebe os dados do Deck (Tocando Agora e Próximas) direto do Python
    socket.on('atualizar_deck_vdj', (deck) => {
        estado.deckPista = deck;
        io.emit('deck_atualizado', estado.deckPista);
    });

    // NOVO PEDIDO (PISTA)
    socket.on('novo_pedido_pista', (pedido) => {
        const agora = Date.now();
        
        // 1. Trava de duplicidade na fila
        const naFila = estado.filaPista.some(p => p.titulo === pedido.titulo && p.artista === pedido.artista);
        if (naFila) return socket.emit('erro_pedido', { msg: 'Essa música já está na fila!' });

        // 2. Trava de Cooldown (2 horas)
        const tocouRecentemente = estado.historicoPista.some(p => {
            return p.titulo === pedido.titulo && p.artista === pedido.artista && (agora - p.timestamp_tocado) < COOLDOWN_MS;
        });
        
        if (tocouRecentemente) return socket.emit('erro_pedido', { msg: 'Essa é sucesso e já tocou! Tente de novo mais tarde.' });

        // Se passou, adiciona à fila
        estado.filaPista.push(pedido);
        io.emit('fila_pista_atualizada', estado.filaPista);
    });

    // NOVO PEDIDO (KARAOKÊ)
    socket.on('novo_pedido_karaoke', (pedido) => {
        estado.filaKaraoke.push(pedido);
        io.emit('fila_karaoke_atualizada', estado.filaKaraoke);
    });

    // QUANDO O PYTHON AVISA QUE UMA MÚSICA DA FILA COMEÇOU A TOCAR
    socket.on('musica_tocada', (dados) => {
        // Remove da fila
        estado.filaPista = estado.filaPista.filter(p => !(p.titulo === dados.titulo && p.artista === dados.artista));
        
        // Adiciona ao histórico
        estado.historicoPista.push({ ...dados, timestamp_tocado: Date.now() });

        io.emit('estado_atualizado', {
            filaPista: estado.filaPista,
            historicoPista: estado.historicoPista.slice(-10),
            deckPista: estado.deckPista
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
