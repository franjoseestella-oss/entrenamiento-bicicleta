from http.server import BaseHTTPRequestHandler
import json
import tempfile


class handler(BaseHTTPRequestHandler):

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length))

            email    = (body.get('email') or '').strip()
            password = (body.get('password') or '').strip()
            mfa_code = (body.get('mfa_code') or '').strip() or None
            workouts = body.get('workouts', [])

            if not email or not password:
                return self._json(400, {'error': 'Email y contraseña son obligatorios.'})
            if not workouts:
                return self._json(400, {'error': 'El plan no contiene entrenamientos.'})

            from garminconnect import Garmin

            _needs_mfa = False

            def ask_mfa():
                nonlocal _needs_mfa
                if not mfa_code:
                    _needs_mfa = True
                    raise RuntimeError('MFA_NEEDED')
                return mfa_code

            token_dir = tempfile.mkdtemp()
            try:
                g = Garmin(email, password, prompt_mfa=ask_mfa)
                g.login(token_dir)
            except Exception as exc:
                if _needs_mfa:
                    return self._json(202, {'needs_mfa': True})
                msg = str(exc).lower()
                if '429' in msg or 'too many' in msg:
                    return self._json(429, {
                        'error': 'Garmin ha bloqueado los intentos temporalmente (error 429). '
                                 'Espera 15–30 minutos e inténtalo de nuevo.'
                    })
                if '401' in msg or 'unauthorized' in msg or 'invalid_grant' in msg:
                    return self._json(401, {'error': 'Email o contraseña incorrectos.'})
                return self._json(502, {'error': f'Error de login en Garmin: {exc}'})

            ok_list, err_list = [], []
            for item in workouts:
                try:
                    payload = item['workout']
                    nombre  = payload.get('workoutName', 'Workout')
                    fecha   = item.get('date')
                    res     = g.upload_workout(payload)
                    wid     = res.get('workoutId') if isinstance(res, dict) else None
                    if not wid:
                        err_list.append({'name': nombre, 'error': 'La API no devolvió workoutId'})
                        continue
                    if fecha:
                        g.schedule_workout(wid, fecha)
                    ok_list.append({'name': nombre, 'date': fecha or ''})
                except Exception as exc:
                    nombre = item.get('workout', {}).get('workoutName', '?')
                    err_list.append({'name': nombre, 'error': str(exc)})

            return self._json(200, {
                'uploaded': len(ok_list),
                'total':    len(workouts),
                'ok':       ok_list,
                'errors':   err_list,
            })

        except Exception as exc:
            return self._json(500, {'error': f'Error inesperado: {exc}'})

    def _json(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin',  '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def log_message(self, *args):
        pass
