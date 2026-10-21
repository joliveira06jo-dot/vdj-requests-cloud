const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

let dbBiblioteca = []; 
let filaPista = [];
let filaKaraoke = [];
let historicoJaRolou = [];

io.on('connection', (socket) => {
    socket.emit('sync_state', { filaPista, filaKaraoke, historicoJaRolou });
    if (dbBiblioteca.length > 0) {
        socket.emit('update_biblioteca', dbBiblioteca);
    }

    socket.on('update_biblioteca', (dados) => {
        if (dados && dados.length > 0) {
            dbBiblioteca = dados;
            io.emit('update_biblioteca', dbBiblioteca);
        }
    });

    socket.on('novo_pedido', (pedido) => {
        if (pedido.tipo === 'karaoke') {
            filaKaraoke.push(pedido);
        } else {
            const jaExiste = filaPista.some(p => p.musica.toLowerCase() === pedido.musica.toLowerCase());
            if (jaExiste) {
                socket.emit('erro_pedido', 'Esta música já está na fila de espera!');
                return;
            }
            filaPista.push(pedido);
        }
        io.emit('sync_state', { filaPista, filaKaraoke, historicoJaRolou });
    });

    // Baixa automática enviada pelo Python quando o VirtualDJ executa a música
    socket.on('musica_tocada', (dados) => {
        const index = filaPista.findIndex(p => p.caminho === dados.caminho || p.musica.toLowerCase() === dados.musica.toLowerCase());
        if (index !== -1) {
            const [itemTocado] = filaPista.splice(index, 1);
            itemTocado.horaTocada = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            historicoJaRolou.unshift(itemTocado);
            if (historicoJaRolou.length > 20) historicoJaRolou.pop();
            io.emit('sync_state', { filaPista, filaKaraoke, historicoJaRolou });
        }
    });

    socket.on('admin_acao', ({ tipo, index }) => {
        if (tipo === 'pista') {
            const [removido] = filaPista.splice(index, 1);
            if (removido) {
                removido.horaTocada = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                historicoJaRolou.unshift(removido);
                if (historicoJaRolou.length > 20) historicoJaRolou.pop();
            }
        } else if (tipo === 'karaoke') {
            filaKaraoke.splice(index, 1);
        }
        io.emit('sync_state', { filaPista, filaKaraoke, historicoJaRolou });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
