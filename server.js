const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Deixa a pasta public pronta para hospedar nossos HTMLs

// Bancos de Dados em Memória (Isolamento conforme PRD 4.4)
let dbBiblioteca = []; // Será alimentado automaticamente pelo Python (PRD 5.1)
let filaPista = [];
let filaKaraoke = [];

// Motor de WebSockets: Comunicação instantânea
io.on('connection', (socket) => {
    console.log(`[+] Nova conexão estabelecida: ${socket.id}`);

    // Quando alguém entra (seja o DJ, o OBS ou o Convidado), envia o estado atual do sistema
    socket.emit('sync_state', { filaPista, filaKaraoke });

    // Escuta o Python mandando a lista de músicas do HD
    socket.on('update_biblioteca', (dados) => {
        dbBiblioteca = dados;
        console.log(`[!] Biblioteca física sincronizada: ${dbBiblioteca.length} faixas mapeadas.`);
    });

    // Escuta um novo pedido vindo do celular de um convidado
    socket.on('novo_pedido', (pedido) => {
        // O bloco de validação rigorosa (Anti-Spam, Cooldown, Duplicatas) será inserido aqui na próxima etapa

        if (pedido.tipo === 'karaoke') {
            filaKaraoke.push(pedido);
        } else {
            filaPista.push(pedido);
        }
        
        // Espalha a atualização da fila para todos os aparelhos conectados instantaneamente
        io.emit('sync_state', { filaPista, filaKaraoke });
    });

    socket.on('disconnect', () => {
        console.log(`[-] Conexão encerrada: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Cérebro Node.js operando na porta ${PORT}`);
});