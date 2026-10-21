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

io.on('connection', (socket) => {
    console.log(`[+] Nova conexão: ${socket.id}`);

    // Sincroniza estados iniciais
    socket.emit('sync_state', { filaPista, filaKaraoke });
    if (dbBiblioteca.length > 0) {
        socket.emit('update_biblioteca', dbBiblioteca);
    }

    // Recebe o catálogo do Python
    socket.on('update_biblioteca', (dados) => {
        if (dados && dados.length > 0) {
            dbBiblioteca = dados;
            io.emit('update_biblioteca', dbBiblioteca);
        }
    });

    // Novo pedido (Pista ou Karaokê)
    socket.on('novo_pedido', (pedido) => {
        if (pedido.tipo === 'karaoke') {
            filaKaraoke.push(pedido);
            console.log(`[🎤] Novo Karaokê: ${pedido.musica} por ${pedido.nome}`);
        } else {
            const jaExiste = filaPista.some(p => p.musica.toLowerCase() === pedido.musica.toLowerCase());
            if (jaExiste) {
                socket.emit('erro_pedido', 'Esta música já está na fila de espera!');
                return;
            }
            filaPista.push(pedido);
            console.log(`[🎵] Nova Pista: ${pedido.musica} por ${pedido.nome}`);
        }
        
        io.emit('sync_state', { filaPista, filaKaraoke });
    });

    // Ações do Admin Master (Excluir ou Concluir)
    socket.on('admin_acao', ({ tipo, index }) => {
        if (tipo === 'pista') {
            filaPista.splice(index, 1);
        } else if (tipo === 'karaoke') {
            filaKaraoke.splice(index, 1);
        }
        io.emit('sync_state', { filaPista, filaKaraoke });
    });

    socket.on('disconnect', () => {
        console.log(`[-] Desconectado: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Cérebro Node.js operando na porta ${PORT}`);
});
