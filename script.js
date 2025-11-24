// client socket + UI logic (chess.com style)
const socket = io(undefined, { autoConnect: false });
const boardEl = document.getElementById('board');
const elixirBar = document.getElementById('elixir-bar');
const joinBtn = document.getElementById('join-btn');
const playerSelect = document.getElementById('player-select');
const statusSpan = document.getElementById('status');
const megaOverlay = document.getElementById('mega-overlay');
const meganightSound = document.getElementById('meganight-sound');

let player = null;
let currentState = null;
let prevState = null;
let selectedCell = null;
let validMoves = [];

// build board squares + coords
(function buildBoard(){
    const ranks = document.getElementById('ranks');
    for(let r=8;r>=1;r--){ const d=document.createElement('div'); d.textContent=r; ranks.appendChild(d); }
    const files = document.getElementById('files');
    const letters = ['a','b','c','d','e','f','g','h'];
    letters.forEach(l=>{ const d=document.createElement('div'); d.textContent=l; files.appendChild(d); });

    for(let r=0;r<8;r++){
        for(let c=0;c<8;c++){
            const sq = document.createElement('div');
            sq.className = 'square ' + (((r+c)%2===0)?'light':'dark');
            sq.dataset.row = r;
            sq.dataset.col = c;
            sq.addEventListener('click', ()=> onSquareClick(r,c));
            boardEl.appendChild(sq);
        }
    }
})();

joinBtn.addEventListener('click', ()=> {
    player = playerSelect.value;
    socket.connect();
    socket.emit('join', { player });
    statusSpan.textContent = `Joined as Player ${player}`;
});

socket.on('connect', ()=> console.log('socket connected'));
socket.on('state', (state)=> {
    prevState = currentState;
    currentState = state;
    renderState(state);
    if(prevState && state.last_move && JSON.stringify(prevState.last_move) !== JSON.stringify(state.last_move)){
        animateMove(state.last_move);
    }
});
socket.on('joined', (data)=> console.log('joined', data));
socket.on('move_result', (res)=> { if(res.status !== 'ok') alert(res.message || 'Move failed'); });

function renderState(state){
    const squares = document.querySelectorAll('.square');
    squares.forEach(s => { s.innerHTML=''; s.classList.remove('last-move','valid-move'); });

    for(let r=0;r<8;r++){
        for(let c=0;c<8;c++){
            const sq = document.querySelector(`.square[data-row="${r}"][data-col="${c}"]`);
            const piece = state.board[r][c];
            if(piece){
                const color = piece.owner === 1 ? 'light' : 'dark';
                const img = document.createElement('img');
                img.src = `/static/pieces/${color}_${piece.type}.png`;
                img.alt = piece.type;
                img.title = `${piece.type} HP:${piece.hp}`;
                sq.appendChild(img);
            }
        }
    }

    if(state.last_move){
        const from = state.last_move.from, to = state.last_move.to;
        const fromEl = document.querySelector(`.square[data-row="${from[0]}"][data-col="${from[1]}"]`);
        const toEl = document.querySelector(`.square[data-row="${to[0]}"][data-col="${to[1]}"]`);
        if(fromEl) fromEl.classList.add('last-move');
        if(toEl) toEl.classList.add('last-move');
    }

    if(player && state.elixir){
        drawElixir(state.elixir[player]);
    }
}

function drawElixir(val){
    elixirBar.innerHTML = '';
    for(let i=0;i<10;i++){
        const u=document.createElement('div'); u.className='elixir-unit';
        u.style.opacity = i < val ? '1' : '0.18';
        elixirBar.appendChild(u);
    }
}

function onSquareClick(r,c){
    if(!player){ alert('Выберите Player и нажмите Join'); return; }
    if(!currentState) return;
    const piece = currentState.board[r][c];

    if(selectedCell){
        if(validMoves.some(m => m[0]===r && m[1]===c)){
            socket.emit('move',{ player, from_row:selectedCell.r, from_col:selectedCell.c, to_row:r, to_col:c });
            const movedPiece = currentState.board[selectedCell.r][selectedCell.c];
            if(movedPiece && movedPiece.type === 'knight') playMega();
        }
        selectedCell = null;
        validMoves = [];
        renderState(currentState);
        return;
    }

    if(piece && String(piece.owner) === String(player)){
        selectedCell = { r, c };
        validMoves = getValidMoves(piece, currentState.board, r, c);
        validMoves.forEach(m => {
            const el = document.querySelector(`.square[data-row="${m[0]}"][data-col="${m[1]}"]`);
            if(el) el.classList.add('valid-move');
        });
    }
}

function getValidMoves(piece, board, r, c){
    let moves = [];
    const dirs = {
        "pawn": piece.owner===1? [[1,0],[1,-1],[1,1]]:[[ -1,0],[-1,-1],[-1,1]],
        "rook": [[1,0],[-1,0],[0,1],[0,-1]],
        "bishop": [[1,1],[1,-1],[-1,1],[-1,-1]],
        "queen": [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]],
        "king": [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]],
        "knight": [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]]
    };
    const t = piece.type;
    if(t==='pawn'){
        dirs.pawn.forEach(d=>{
            const nr=r+d[0], nc=c+d[1];
            if(nr>=0&&nr<8&&nc>=0&&nc<8){
                if(d[1]===0 && !board[nr][nc]) moves.push([nr,nc]);
                if(d[1]!==0 && board[nr][nc] && board[nr][nc].owner!==piece.owner) moves.push([nr,nc]);
            }
        });
    } else if(t==='knight' || t==='king'){
        dirs[t].forEach(d=>{
            const nr=r+d[0], nc=c+d[1];
            if(nr>=0&&nr<8&&nc>=0&&nc<8){
                if(!board[nr][nc] || board[nr][nc].owner!==piece.owner) moves.push([nr,nc]);
            }
        });
    } else {
        dirs[t].forEach(d=>{
            let nr=r+d[0], nc=c+d[1];
            while(nr>=0&&nr<8&&nc>=0&&nc<8){
                if(!board[nr][nc]) moves.push([nr,nc]);
                else { if(board[nr][nc].owner!==piece.owner) moves.push([nr,nc]); break; }
                nr+=d[0]; nc+=d[1];
            }
        });
    }
    return moves;
}

function animateMove(last_move){
    if(!last_move) return;
    const from = last_move.from, to = last_move.to;
    const fromEl = document.querySelector(`.square[data-row="${from[0]}"][data-col="${from[1]}"]`);
    const toEl = document.querySelector(`.square[data-row="${to[0]}"][data-col="${to[1]}"]`);
    if(!fromEl || !toEl) return;
    const img = fromEl.querySelector('img'); if(!img) return;
    const clone = img.cloneNode();
    clone.style.position='fixed';
    const fr = fromEl.getBoundingClientRect(), tr = toEl.getBoundingClientRect();
    clone.style.left = fr.left + (fr.width - fr.width*0.66)/2 + 'px';
    clone.style.top = fr.top + (fr.height - fr.height*0.66)/2 + 'px';
    clone.style.width = (fr.width*0.66) + 'px'; clone.style.height = (fr.height*0.66) + 'px';
    clone.style.zIndex = 999; clone.style.transition = 'left 350ms ease, top 350ms ease';
    document.body.appendChild(clone);
    img.style.opacity = '0.0';
    requestAnimationFrame(()=> { clone.style.left = tr.left + (tr.width - tr.width*0.66)/2 + 'px'; clone.style.top = tr.top + (tr.height - tr.height*0.66)/2 + 'px'; });
    setTimeout(()=> { clone.remove(); if(img) img.style.opacity='1.0'; }, 420);
}

function playMega(){
    try { meganightSound.currentTime = 0; meganightSound.play(); } catch(e){ console.warn(e); }
    const overlay = document.getElementById('mega-overlay');
    overlay.style.display = 'flex';
    const img = overlay.querySelector('img');
    img.style.transform = 'scale(1)'; img.style.opacity='1';
    setTimeout(()=> { img.style.transform = 'scale(.9)'; overlay.style.display = 'none'; }, 2500);
}
