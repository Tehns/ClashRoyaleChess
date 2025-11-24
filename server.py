from flask import Flask, render_template, jsonify, request
from flask_socketio import SocketIO, emit
import threading
import time

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

state_lock = threading.Lock()

def init_board():
    board = [[None] * 8 for _ in range(8)]
    # pawns
    for c in range(8):
        board[1][c] = {"type":"pawn","hp":10,"owner":1,"elixir_cost":2}
        board[6][c] = {"type":"pawn","hp":10,"owner":2,"elixir_cost":2}
    # rooks
    board[0][0] = board[0][7] = {"type":"rook","hp":20,"owner":1,"elixir_cost":5}
    board[7][0] = board[7][7] = {"type":"rook","hp":20,"owner":2,"elixir_cost":5}
    # knights (MegaKnight)
    board[0][1] = board[0][6] = {"type":"knight","hp":30,"owner":1,"elixir_cost":5}
    board[7][1] = board[7][6] = {"type":"knight","hp":30,"owner":2,"elixir_cost":5}
    # bishops
    board[0][2] = board[0][5] = {"type":"bishop","hp":15,"owner":1,"elixir_cost":3}
    board[7][2] = board[7][5] = {"type":"bishop","hp":15,"owner":2,"elixir_cost":3}
    # queens
    board[0][3] = {"type":"queen","hp":25,"owner":1,"elixir_cost":7}
    board[7][3] = {"type":"queen","hp":25,"owner":2,"elixir_cost":7}
    # kings
    board[0][4] = {"type":"king","hp":30,"owner":1,"elixir_cost":10}
    board[7][4] = {"type":"king","hp":30,"owner":2,"elixir_cost":10}
    return board

# Global state: board + per-player elixir (players "1" and "2")
game_state = {
    "board": init_board(),
    "elixir": {"1": 0, "2": 0},
    "last_move": None
}

def elixir_regen_loop():
    """Background loop: regen elixir separately for player 1 and 2, broadcast state."""
    while True:
        with state_lock:
            for p in ("1", "2"):
                if game_state["elixir"][p] < 10:
                    game_state["elixir"][p] += 1
            socketio.emit('state', game_state)
        time.sleep(1.5)

threading.Thread(target=elixir_regen_loop, daemon=True).start()

def get_valid_moves(piece, r, c, board):
    moves = []
    dirs = {
        "pawn": [[1,0],[1,-1],[1,1]] if piece["owner"]==1 else [[-1,0],[-1,-1],[-1,1]],
        "rook": [[1,0],[-1,0],[0,1],[0,-1]],
        "bishop": [[1,1],[1,-1],[-1,1],[-1,-1]],
        "queen": [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]],
        "king": [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]],
        "knight": [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]]
    }
    t = piece["type"]
    if t == "pawn":
        for d in dirs["pawn"]:
            nr, nc = r+d[0], c+d[1]
            if 0<=nr<8 and 0<=nc<8:
                if d[1] == 0 and not board[nr][nc]:
                    moves.append([nr,nc])
                if d[1] != 0 and board[nr][nc] and board[nr][nc]["owner"] != piece["owner"]:
                    moves.append([nr,nc])
    elif t in ("knight","king"):
        for d in dirs[t]:
            nr, nc = r+d[0], c+d[1]
            if 0<=nr<8 and 0<=nc<8:
                if not board[nr][nc] or board[nr][nc]["owner"] != piece["owner"]:
                    moves.append([nr,nc])
    else:
        for d in dirs[t]:
            nr, nc = r+d[0], c+d[1]
            while 0<=nr<8 and 0<=nc<8:
                if not board[nr][nc]:
                    moves.append([nr,nc])
                else:
                    if board[nr][nc]["owner"] != piece["owner"]:
                        moves.append([nr,nc])
                    break
                nr += d[0]; nc += d[1]
    return moves

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/state')
def rest_state():
    with state_lock:
        return jsonify(game_state)

@socketio.on('connect')
def on_connect():
    sid = request.sid
    with state_lock:
        socketio.emit('state', game_state, to=sid)

@socketio.on('join')
def on_join(data):
    player = str(data.get('player'))
    with state_lock:
        emit('joined', {'player': player, 'state': game_state})

@socketio.on('move')
def on_move(data):
    """
    data: { player: "1", from_row:int, from_col:int, to_row:int, to_col:int }
    """
    player = str(data.get('player'))
    try:
        fr = int(data.get('from_row')); fc = int(data.get('from_col'))
        tr = int(data.get('to_row')); tc = int(data.get('to_col'))
    except Exception:
        emit('move_result', {'status':'error','message':'Bad coords'}, to=request.sid)
        return

    with state_lock:
        if not (0<=fr<8 and 0<=fc<8 and 0<=tr<8 and 0<=tc<8):
            emit('move_result', {'status':'error','message':'Out of bounds'}, to=request.sid); return

        piece = game_state['board'][fr][fc]
        if not piece:
            emit('move_result', {'status':'error','message':'No piece at source'}, to=request.sid); return

        # ensure player owns piece
        if str(piece.get('owner')) != player:
            emit('move_result', {'status':'error','message':'You do not own this piece'}, to=request.sid); return

        # elixir check per player
        if game_state['elixir'].get(player,0) < piece.get('elixir_cost',0):
            emit('move_result', {'status':'error','message':'Not enough elixir'}, to=request.sid); return

        valid_moves = get_valid_moves(piece, fr, fc, game_state['board'])
        if [tr,tc] not in valid_moves:
            emit('move_result', {'status':'error','message':'Invalid move'}, to=request.sid); return

        # apply move
        game_state['elixir'][player] -= piece.get('elixir_cost',0)
        target = game_state['board'][tr][tc]
        if target:
            target['hp'] -= 5
            if target['hp'] <= 0:
                game_state['board'][tr][tc] = None
        else:
            game_state['board'][tr][tc] = piece
            game_state['board'][fr][fc] = None

        game_state['last_move'] = {'from':[fr,fc],'to':[tr,tc],'player':player}

        socketio.emit('state', game_state)
        emit('move_result', {'status':'ok','game_state':game_state}, to=request.sid)

if __name__ == "__main__":
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
