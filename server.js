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

    // Envia o estado atual e a biblioteca para quem acabou de conectar
    socket.emit('sync_state', { filaPista, filaKaraoke });
    socket.emit('update_biblioteca', dbBiblioteca);

    // Python envia o catálogo do HD
    socket.on('update_biblioteca', (dados) => {
        dbBiblioteca = dados;
        console.log(`[!] Biblioteca sincronizada: ${dbBiblioteca.length} faixas.`);
        // Repassa o catálogo atualizado para todos os celulares conectados
        io.emit('update_biblioteca', dbBiblioteca);
    });

    // Convidado envia um novo pedido
    socket.on('novo_pedido', (pedido) => {
        // Validação de Duplicata na Fila
        const jaExiste = filaPista.some(p => p.musica.toLowerCase() === pedido.musica.toLowerCase());
        if (jaExiste) {
            socket.emit('erro_pedido', 'Esta música já está na fila de espera!');
            return;
        }

        if (pedido.tipo === 'karaoke') {
            filaKaraoke.push(pedido);
        } else {
            filaPista.push(pedido);
        }
        
        io.emit('sync_state', { filaPista, filaKaraoke });
    });

    socket.on('disconnect', () => {
        console.log(`[-] Desconectado: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Cérebro Node.js na porta ${PORT}`);
});
