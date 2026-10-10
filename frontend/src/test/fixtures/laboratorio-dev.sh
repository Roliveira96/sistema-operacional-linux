#!/bin/bash
# ==============================================================================
# 🚀 MISSÃO DEV: SETUP DO AMBIENTE DE ESTUDOS
# Criado com carinho para os alunos do Professor Ricardo!
# ==============================================================================

set -e

# Define a pasta base
DEST_USER="ricardo"
if id "$DEST_USER" &>/dev/null; then
    BASE_DIR="/home/$DEST_USER/laboratorio_dev"
else
    BASE_DIR="$HOME/laboratorio_dev"
fi

echo "🛸 Criando ambiente em: $BASE_DIR..."

# 1. Criação das pastas e subpastas
mkdir -p "$BASE_DIR/missoes"
mkdir -p "$BASE_DIR/projetos_web/site_cyberpunk/css"
mkdir -p "$BASE_DIR/projetos_web/site_cyberpunk/js"
mkdir -p "$BASE_DIR/projetos_web/site_cyberpunk/assets"
mkdir -p "$BASE_DIR/projetos_web/mini_game/scripts"
mkdir -p "$BASE_DIR/projetos_web/mini_game/estilos"
mkdir -p "$BASE_DIR/documentacoes"
mkdir -p "$BASE_DIR/anotacoes/aulas"
mkdir -p "$BASE_DIR/laboratorio_secreto/desafios"

# 2. README principal
cat << 'EOF' > "$BASE_DIR/README.md"
# 🚀 Bem-vindo ao Laboratório Dev!

Olá, futuro(a) Dev! Este ambiente foi preparado pelo Professor Ricardo especialmente para a sua jornada no mundo da tecnologia e do terminal Linux.

## 🧭 Mapa da Estação Espacial:
* 📁 **projetos_web/**: Projetos reais com HTML, CSS e JavaScript prontos para explorar.
* 📁 **missoes/**: Suas tarefas e objetivos práticos.
* 📁 **anotacoes/**: Espaço livre para resumos de aula e dicas de terminal.
* 📁 **laboratorio_secreto/**: Desafios especiais e easter eggs para quem tem curiosidade!

## ⚡ Dica de Sobrevivência:
> "Errar faz parte do código. Ler a mensagem de erro é o verdadeiro superpoder!" 🦸‍♂️🦸‍♀️
EOF

# 3. Projeto 1: Site Cyberpunk (HTML, CSS e JS)
cat << 'EOF' > "$BASE_DIR/projetos_web/site_cyberpunk/index.html"
<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cyberpunk Dev Hub</title>
    <link rel="stylesheet" href="css/style.css">
</head>
<body>
    <div class="card">
        <h1>🛸 Terminal do Professor Ricardo</h1>
        <p>Bem-vindo ao hub secreto dos desenvolvedores!</p>
        <button id="btnConectar">Conectar à Rede</button>
        <div class="terminal" id="terminal-output">Aguardando conexão...</div>
    </div>
    <script src="js/app.js"></script>
</body>
</html>
EOF

cat << 'EOF' > "$BASE_DIR/projetos_web/site_cyberpunk/css/style.css"
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    background-color: #0b0f19;
    color: #00ffcc;
    font-family: 'Courier New', Courier, monospace;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
}

.card {
    background: rgba(18, 24, 38, 0.95);
    border: 2px solid #00ffcc;
    border-radius: 12px;
    padding: 2.5rem;
    box-shadow: 0 0 25px rgba(0, 255, 204, 0.35);
    text-align: center;
    max-width: 500px;
    width: 90%;
}

h1 {
    font-size: 1.5rem;
    margin-bottom: 1rem;
    text-shadow: 0 0 8px #00ffcc;
}

button {
    margin-top: 1.5rem;
    padding: 0.8rem 1.6rem;
    background: #ff007f;
    border: none;
    color: #fff;
    font-weight: bold;
    cursor: pointer;
    border-radius: 6px;
    font-size: 1rem;
    transition: transform 0.2s, background 0.2s;
}

button:hover {
    background: #ff3399;
    transform: scale(1.05);
}

.terminal {
    margin-top: 1.5rem;
    padding: 1rem;
    background: #000;
    border: 1px dashed #00ffcc;
    min-height: 50px;
    font-size: 0.9rem;
    color: #a6e22e;
}
EOF

cat << 'EOF' > "$BASE_DIR/projetos_web/site_cyberpunk/js/app.js"
const btn = document.getElementById('btnConectar');
const output = document.getElementById('terminal-output');

const frases = [
    "📡 Sinal interceptado...",
    "🔑 Decodificando chaves de acesso...",
    "💻 Professor Ricardo detectado na rede!",
    "🚀 Compilação concluída com 100% de sucesso!",
    "🍕 Pizza solicitada para a equipe de devs!"
];

let indice = 0;

btn.addEventListener('click', () => {
    output.innerText = frases[indice % frases.length];
    indice++;
});
EOF

# 4. Projeto 2: Mini Game de Adivinhação
cat << 'EOF' > "$BASE_DIR/projetos_web/mini_game/index.html"
<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <title>Mini Game: Adivinhe o Número</title>
    <link rel="stylesheet" href="estilos/game.css">
</head>
<body>
    <div class="container">
        <h2>🎮 Adivinhe o número de 1 a 10</h2>
        <input type="number" id="palpite" min="1" max="10">
        <button onclick="jogar()">Jogar</button>
        <p id="resultado"></p>
    </div>
    <script src="scripts/game.js"></script>
</body>
</html>
EOF

cat << 'EOF' > "$BASE_DIR/projetos_web/mini_game/estilos/game.css"
body {
    background: #1e1e2f;
    color: #fff;
    font-family: sans-serif;
    display: grid;
    place-items: center;
    height: 100vh;
    margin: 0;
}
.container {
    background: #2a2a40;
    padding: 2rem;
    border-radius: 10px;
    text-align: center;
    box-shadow: 0 4px 15px rgba(0,0,0,0.4);
}
input {
    padding: 0.5rem;
    border-radius: 5px;
    border: none;
    width: 60px;
    font-size: 1.1rem;
    text-align: center;
}
button {
    padding: 0.5rem 1rem;
    border-radius: 5px;
    background: #4e54c8;
    color: white;
    border: none;
    cursor: pointer;
    font-weight: bold;
}
button:hover {
    background: #6c71e8;
}
EOF

cat << 'EOF' > "$BASE_DIR/projetos_web/mini_game/scripts/game.js"
const numeroSecreto = Math.floor(Math.random() * 10) + 1;

function jogar() {
    const chute = parseInt(document.getElementById('palpite').value);
    const msg = document.getElementById('resultado');

    if (chute === numeroSecreto) {
        msg.innerHTML = "🎉 PARABÉNS! Você descobriu o segredo!";
        msg.style.color = "#4cd137";
    } else {
        msg.innerHTML = "❌ Quase lá! Tente novamente.";
        msg.style.color = "#e84118";
    }
}
EOF

# 5. Missões e Arquivos TXT / MD
cat << 'EOF' > "$BASE_DIR/missoes/missao_01_primeiros_passos.txt"
📜 MISSÃO 01: DOMINANDO O TERMINAL LINUX

Objetivo:
1. Use o comando 'cd' para navegar até 'projetos_web/site_cyberpunk'.
2. Use 'ls -la' para listar os arquivos com permissões.
3. Abra o arquivo 'index.html' no navegador.
4. Mude a cor de fundo no arquivo 'css/style.css'.
5. Volte para a pasta raiz com 'cd ../..'.

Recompensa: +150 XP de Desenvolvedor! 🌟
EOF

cat << 'EOF' > "$BASE_DIR/anotacoes/dicas_de_terminal.txt"
GUIA RÁPIDO DE COMANDOS:
- pwd        : Mostra em qual pasta você está agora.
- ls         : Lista arquivos da pasta.
- cd <pasta> : Entra em uma pasta.
- cd ..      : Volta uma pasta para trás.
- cat <arq>  : Lê o conteúdo de um arquivo sem abrir editor.
- nano <arq> : Abre o editor simples no terminal.
EOF

cat << 'EOF' > "$BASE_DIR/documentacoes/guia_git.md"
# 🐙 Guia Ninja de Git

Aqui estão os 4 comandos sagrados que salvam vidas:

```bash
git status
git add .
git commit -m "feat: minha alteração incrível"
git push origin main
```
EOF

# 6. Desafio Secreto (Easter Egg)
cat << 'EOF' > "$BASE_DIR/laboratorio_secreto/desafios/enigma.txt"
🕵️‍♂️ DESAFIO SECRETO ENCONTRADO!
Se você encontrou este arquivo usando apenas comandos como 'find' ou 'grep',
mostre a tela para o Professor Ricardo e peça um bônus dev! 🎁
EOF

# 7. Ajuste de Permissões
if id "$DEST_USER" &>/dev/null; then
    chown -R "$DEST_USER":"$DEST_USER" "$BASE_DIR" 2>/dev/null || true
fi

echo ""
echo "✅ AMBIENTE CRIADO COM SUCESSO!"
echo "✨ Arquivos prontos em: $BASE_DIR"
echo "🎮 Bom aprendizado para toda a turma!"
