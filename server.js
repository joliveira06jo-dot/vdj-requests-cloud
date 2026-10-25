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
    curtidas: {} 
};

io.on('connection', (socket) => {
    console.log(`Nova conexão: ${socket.id}`);

    socket.emit('estado_atualizado', {
        filaPista: estado.filaPista,
        filaKaraoke: estado.filaKaraoke,
        historicoPista: estado.historicoPista.slice(-10),
        deckPista: estado.deckPista
    });
    socket.emit('catalogo_atualizado', estado.catalogo);

    socket.on('sync_catalogo', (dadosPython) => {
        estado.catalogo = dadosPython;
        io.emit('catalogo_atualizado', estado.catalogo);
    });

    socket.on('atualizar_deck_vdj', (deck) => {
        if (deck.proximas) estado.deckPista.proximas = deck.proximas;
        if (deck.tocandoAgora) estado.deckPista.tocandoAgora = deck.tocandoAgora;
        io.emit('deck_atualizado', estado.deckPista);
    });

    socket.on('novo_pedido_pista', (pedido) => {
        const agora = Date.now();
        const naFila = estado.filaPista.some(p => p.titulo === pedido.titulo && p.artista === pedido.artista);
        if (naFila) return socket.emit('erro_pedido', { msg: 'Essa música já está na fila!' });

        const tocouRecentemente = estado.historicoPista.some(p => {
            return p.titulo === pedido.titulo && p.artista === pedido.artista && (agora - p.timestamp_tocado) < COOLDOWN_MS;
        });
        
        if (tocouRecentemente) return socket.emit('erro_pedido', { msg: 'Essa é sucesso e já tocou! Tente de novo mais tarde.' });

        estado.filaPista.push(pedido);
        io.emit('fila_pista_atualizada', estado.filaPista);
    });

    socket.on('novo_pedido_karaoke', (pedido) => {
        estado.filaKaraoke.push(pedido);
        io.emit('fila_karaoke_atualizada', estado.filaKaraoke);
    });

    socket.on('musica_tocada', (dados) => {
        // 1. Procura a música na fila de pedidos
        const index = estado.filaPista.findIndex(p => 
            p.titulo.toLowerCase().includes(dados.titulo.toLowerCase()) || 
            dados.titulo.toLowerCase().includes(p.titulo.toLowerCase())
        );

        if (index !== -1) {
            // 2. Se achou, é um pedido de usuário! Move para o histórico e tira da fila.
            const pedidoTocado = estado.filaPista.splice(index, 1)[0];
            pedidoTocado.timestamp_tocado = Date.now();
            pedidoTocado.hora = dados.hora; // Hora que o VDJ tocou
            estado.historicoPista.push(pedidoTocado);
        }
        // Se não achou, foi o DJ tocando algo aleatório. Não vai para o histórico.

        // 3. Atualiza o "Tocando Agora" para todo mundo
        estado.deckPista.tocandoAgora = {
            titulo: dados.titulo,
            artista: dados.artista,
            capa: dados.capa || "https://i.ibb.co/xLqB8zP/placeholder-wide.jpg"
        };

        io.emit('estado_atualizado', {
            filaPista: estado.filaPista,
            historicoPista: estado.historicoPista.slice(-10),
            deckPista: estado.deckPista
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
