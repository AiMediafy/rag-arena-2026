from flask import Flask, request, jsonify, send_from_directory
import os, requests, time
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(override=True)

app = Flask(__name__, static_folder='.')

# ── MONGODB ───────────────────────────────────────────────
MONGO_URI = os.getenv("MONGO_URI")
stats_col = None

if MONGO_URI:
    try:
        client = MongoClient(MONGO_URI)
        db = client['rag_arena']
        stats_col = db['scores']
        print("✅ MongoDB połączone")
    except Exception as e:
        print(f"❌ MongoDB błąd: {e}")
else:
    print("⚠️  Brak MONGO_URI — ranking wyłączony")

def increment_score(username):
    if stats_col is not None:
        try:
            stats_col.update_one({"username": username}, {"$inc": {"score": 1}}, upsert=True)
        except Exception as e:
            print(f"DB błąd: {e}")

# ── UŻYTKOWNICY ───────────────────────────────────────────
USERS = {}
for entry in os.getenv("USERS", "").split(","):
    if ":" in entry:
        k, v = entry.strip().split(":", 1)
        USERS[k.strip()] = v.strip()

# ── ROUTING ───────────────────────────────────────────────
@app.route('/')
def index():
    return send_from_directory('public', 'index.html')

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('public', path)

# ── API: LOGIN ────────────────────────────────────────────
@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    user = data.get('username', '').strip()
    pw   = data.get('password', '').strip()
    if user in USERS and USERS[user] == pw:
        return jsonify({"success": True, "username": user})
    return jsonify({"success": False, "message": "Błędne dane logowania"}), 401

# ── API: CHAT ─────────────────────────────────────────────
@app.route('/api/chat', methods=['POST'])
def chat():
    data  = request.json
    model = data.get('model', 'A')          # 'A' lub 'B'
    user  = data.get('user', '').upper()

    # Inkrementuj score przy każdym pytaniu
    if data.get('user'):
        increment_score(data['user'])

    # Szukaj webhooka: najpierw per-user, potem globalny fallback
    webhook = (
        os.getenv(f"WEBHOOK_{model}_{user}") or
        os.getenv(f"WEBHOOK_{model}")
    )

    if not webhook:
        return jsonify({"output": f"⚠ Brak webhooka dla modelu {model} (użytkownik: {user})", "latency": 0}), 500

    t0 = time.time()
    try:
        resp = requests.post(webhook, json=data, timeout=60)
        latency = round(time.time() - t0, 2)

        if resp.status_code == 200:
            raw = resp.json()
            # Normalizacja pola odpowiedzi — obsługuje różne formaty n8n
            output = (
                raw.get('output') or raw.get('response') or
                raw.get('text')   or raw.get('answer')   or
                raw.get('message') or raw.get('content') or
                str(raw)
            )
            return jsonify({"output": output, "latency": latency})
        else:
            return jsonify({"output": f"⚠ n8n zwróciło {resp.status_code}", "latency": round(time.time()-t0, 2)})

    except requests.Timeout:
        return jsonify({"output": "⚠ Timeout — agent nie odpowiedział w 60s", "latency": 60}), 504
    except Exception as e:
        return jsonify({"output": f"⚠ Błąd serwera: {e}", "latency": round(time.time()-t0, 2)}), 500

# ── API: FEEDBACK ─────────────────────────────────────────
@app.route('/api/feedback', methods=['POST'])
def feedback():
    data = request.json
    hooks = list(filter(None, [
        os.getenv("FEEDBACK_WEBHOOK_A"),
        os.getenv("FEEDBACK_WEBHOOK_B"),
    ]))
    errors = []
    for h in hooks:
        try:
            requests.post(h, json=data, timeout=15)
        except Exception as e:
            errors.append(str(e))
    if errors:
        return jsonify({"success": False, "errors": errors}), 500
    return jsonify({"success": True})

# ── API: LEADERBOARD ──────────────────────────────────────
@app.route('/api/leaderboard', methods=['GET'])
def leaderboard():
    if stats_col is None:
        return jsonify([])
    try:
        cursor = stats_col.find({"username": {"$ne": "admin"}}).sort("score", -1).limit(10)
        result = [{"username": d['username'], "score": d['score']} for d in cursor]
        return jsonify(result)
    except Exception as e:
        print(f"Leaderboard błąd: {e}")
        return jsonify([])

# ── START ─────────────────────────────────────────────────
if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
