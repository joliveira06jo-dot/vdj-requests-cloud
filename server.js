const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Linha adicionada para o servidor exibir a sua interface visual
app.use(express.static('public'));

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// Bancos de dados em memória
let filaPista = [];
let filaKaraoke = [];

// API: Busca de Capas no iTunes (Fallback quando o HD falhar)
app.get('/api/cover', async (req, res) => {
    const { artist, track } = req.query;
    if (!artist || !track) return res.status(400).json({ erro: 'Parâmetros artist e track são obrigatórios' });

    try {
        const termo = encodeURIComponent(`${artist} ${track}`);
        const resposta = await axios.get(`https://itunes.apple.com/search?term=${termo}&entity=song&limit=1`);

        if (resposta.data.results && resposta.data.results.length > 0) {
            let capaAltaRes = resposta.data.results[0].artworkUrl100.replace('100x100bb', '600x600bb');
            return res.json({ url: capaAltaRes });
        }
        res.status(404).json({ erro: 'Capa não encontrada no iTunes' });
    } catch (erro) {
        res.status(500).json({ erro: 'Falha na comunicação com a Apple Music' });
    }
});

// Comunicação em Tempo Real
io.on('connection', (socket) => {
    console.log(`Cliente conectado: ${socket.id}`);

    socket.on('pedir_musica', (dados) => {
        io.emit('novo_pedido', { caminho: dados.caminho });
        filaPista.push(dados);
        io.emit('atualizacao_fila', filaPista);
    });

    socket.on('pedir_karaoke', (dados) => {
        filaKaraoke.push(dados);
        io.emit('atualizacao_karaoke', filaKaraoke);
    });

    socket.on('disconnect', () => {
        console.log(`Cliente desconectado: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor Node.js rodando na porta ${PORT}`);
});
