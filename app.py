from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit
from flask_cors import CORS
import random
import string
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your_secret_key'
CORS(app, resources={r"/*": {"origins": "*"}})
socketio = SocketIO(app, cors_allowed_origins="*", logger=True, engineio_logger=True)

# Store active connections and codes
active_codes = {}  # code -> socket_id
active_connections = {}  # socket_id -> code

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('connect')
def handle_connect():
    logger.info(f"Client connected: {request.sid}")
    emit('connection_success', {'sid': request.sid})

@socketio.on('generate_code')
def handle_generate_code():
    code = ''.join(random.choices(string.digits, k=6))
    active_codes[code] = request.sid
    active_connections[request.sid] = code
    
    logger.info(f"=== ACTIVE CODES ===")
    logger.info(active_codes)
    logger.info(f"Generated new code: {code} for user {request.sid}")
    
    emit('code_generated', {'code': code})

@socketio.on('join_code')
def handle_join_code(data):
    code = data.get('code')
    logger.info(f"=== JOIN ATTEMPT ===")
    logger.info(f"Trying to join with code: {code}")
    logger.info(f"Current active codes: {active_codes}")
    logger.info(f"Joiner's socket ID: {request.sid}")
    
    if not code:
        emit('error_message', {'message': 'No code provided'})
        return
        
    if code in active_codes:
        peer_sid = active_codes[code]
        
        # Prevent self-joining
        if peer_sid == request.sid:
            logger.warning(f"Self-join attempt rejected for {request.sid}")
            emit('error_message', {'message': 'Cannot join your own code'})
            return
            
        logger.info(f"Found matching peer: {peer_sid}")
        emit('peer_joined', {'peer_sid': request.sid}, room=peer_sid)
        emit('code_accepted', {'peer_sid': peer_sid})
        
        # Remove used code
        active_codes.pop(code)
        active_connections.pop(peer_sid, None)
    else:
        logger.warning(f"No matching code found in active_codes")
        emit('error_message', {'message': 'Invalid or expired code'})

@socketio.on('signal')
def handle_signal(data):
    if 'target_sid' in data:
        target_sid = data['target_sid']
        # Include sender's ID in the signal data
        data['sender_sid'] = request.sid
        logger.info(f"Relaying signal from {request.sid} to {target_sid}")
        emit('signal', data, room=target_sid)
    else:
        logger.error("No target_sid in signal data")
        emit('error_message', {'message': 'Invalid signal data'})

@socketio.on('disconnect')
def handle_disconnect():
    sid = request.sid
    if sid in active_connections:
        code = active_connections[sid]
        active_codes.pop(code, None)
        active_connections.pop(sid)
        logger.info(f"Client disconnected: {sid}")

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)