const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const DB_FILE = path.join(__dirname, 'estado.json');

let estado = {
    dbBiblioteca: [],
    filaPista: [],
    filaKaraoke: [],
    historicoJaRolou: []
};

if (fs.existsSync(DB_FILE)) {
    try {
        estado = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
        if (!estado.historicoJaRolou) estado.historicoJaRolou = [];
    } catch (e) {
        console.log("Criando novo banco de estado local.");
    }
}

function salvarEstado() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(estado, null, 2));
    } catch (e) {
        console.error("Erro ao salvar estado.json:", e);
    }
}

io.on('connection', (socket) => {
    socket.emit('sync_state', { 
        filaPista: estado.filaPista, 
        filaKaraoke: estado.filaKaraoke, 
        historicoJaRolou: estado.historicoJaRolou 
    });

    if (estado.dbBiblioteca.length > 0) {
        socket.emit('update_biblioteca', estado.dbBiblioteca);
    }

    socket.on('update_biblioteca', (dados) => {
        if (dados && dados.length > 0) {
            estado.dbBiblioteca = dados;
            salvarEstado();
            io.emit('update_biblioteca', estado.dbBiblioteca);
        }
    });

    socket.on('novo_pedido', (pedido) => {
        if (pedido.tipo === 'karaoke') {
            estado.filaKaraoke.push(pedido);
        } else {
            const jaExiste = estado.filaPista.some(p => p.musica.toLowerCase() === pedido.musica.toLowerCase());
            if (jaExiste) {
                socket.emit('erro_pedido', 'Esta música já está na fila de espera!');
                return;
            }
            estado.filaPista.push(pedido);
        }
        salvarEstado();
        io.emit('sync_state', { 
            filaPista: estado.filaPista, 
            filaKaraoke: estado.filaKaraoke, 
            historicoJaRolou: estado.historicoJaRolou 
        });
    });

    socket.on('restaurar_fila', (filaLocal) => {
        if (estado.filaPista.length === 0 && filaLocal && filaLocal.length > 0) {
            console.log("[RECUPERAÇÃO] Restaurando fila local enviada pela ponte Python.");
            estado.filaPista = filaLocal;
            salvarEstado();
            io.emit('sync_state', { 
                filaPista: estado.filaPista, 
                filaKaraoke: estado.filaKaraoke, 
                historicoJaRolou: estado.historicoJaRolou 
            });
        }
    });

    // Baixa de pedido de convidado
    socket.on('musica_tocada', (dados) => {
        const index = estado.filaPista.findIndex(p => p.caminho === dados.caminho || p.musica.toLowerCase() === dados.musica.toLowerCase());
        if (index !== -1) {
            const [itemTocado] = estado.filaPista.splice(index, 1);
            itemTocado.horaTocada = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            estado.historicoJaRolou.unshift(itemTocado);
            if (estado.historicoJaRolou.length > 30) estado.historicoJaRolou.pop();
            salvarEstado();
            io.emit('sync_state', { 
                filaPista: estado.filaPista, 
                filaKaraoke: estado.filaKaraoke, 
                historicoJaRolou: estado.historicoJaRolou 
            });
        }
    });

    // Registro de música tocada diretamente pelo DJ (fora dos pedidos)
    socket.on('musica_tocada_dj', (dados) => {
        const horaAtual = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const itemDJ = {
            musica: dados.musica,
            artista: dados.artista,
            nome: 'Seleção do DJ',
            horaTocada: horaAtual
        };

        const jaExisteRecente = estado.historicoJaRolou.some(h => 
            h.musica.toLowerCase() === itemDJ.musica.toLowerCase() && h.horaTocada === horaAtual
        );

        if (!jaExisteRecente) {
            estado.historicoJaRolou.unshift(itemDJ);
            if (estado.historicoJaRolou.length > 30) estado.historicoJaRolou.pop();
            salvarEstado();
            io.emit('sync_state', { 
                filaPista: estado.filaPista, 
                filaKaraoke: estado.filaKaraoke, 
                historicoJaRolou: estado.historicoJaRolou 
            });
        }
    });

    socket.on('admin_acao', ({ tipo, index }) => {
        if (tipo === 'pista') {
            const [removido] = estado.filaPista.splice(index, 1);
            if (removido) {
                removido.horaTocada = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                estado.historicoJaRolou.unshift(removido);
                if (estado.historicoJaRolou.length > 30) estado.historicoJaRolou.pop();
            }
        } else if (tipo === 'karaoke') {
            estado.filaKaraoke.splice(index, 1);
        }
        salvarEstado();
        io.emit('sync_state', { 
            filaPista: estado.filaPista, 
            filaKaraoke: estado.filaKaraoke, 
            historicoJaRolou: estado.historicoJaRolou 
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Servidor VDJ Requests operando na porta ${PORT}`);
});
