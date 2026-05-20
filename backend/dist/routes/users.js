"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
function toRow(u) {
    return {
        id: String(u.id),
        nombre: u.nombre,
        email: u.email,
        rol: u.rol_display,
        ultimoAcceso: u.ultimo_acceso ?? '—',
        activo: Boolean(u.activo),
        iniciales: u.iniciales,
    };
}
router.get('/', auth_1.requireAuth, auth_1.requireAdmin, (_req, res) => {
    const db = (0, db_1.getDb)();
    const rows = db.prepare('SELECT * FROM users ORDER BY id').all();
    res.json(rows.map(toRow));
});
router.post('/', auth_1.requireAuth, auth_1.requireAdmin, (req, res) => {
    const { nombre, email, rol, activo, password } = req.body;
    if (!nombre || !email || !rol) {
        res.status(400).json({ error: 'Nombre, correo y rol son requeridos' });
        return;
    }
    const rolMap = {
        Administrador: 'admin',
        Secretaria: 'secretaria',
        Docente: 'docente',
        Estudiante: 'estudiante',
    };
    const rolInterno = rolMap[rol] ?? 'docente';
    const iniciales = nombre.trim().split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
    const hash = bcryptjs_1.default.hashSync(password ?? 'changeme123', 10);
    const db = (0, db_1.getDb)();
    try {
        const result = db.prepare(`
      INSERT INTO users (nombre, email, password_hash, rol, rol_display, activo, iniciales)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(nombre.trim(), email.trim().toLowerCase(), hash, rolInterno, rol, activo ? 1 : 0, iniciales);
        const created = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
        res.status(201).json(toRow(created));
    }
    catch (err) {
        if (err.message?.includes('UNIQUE')) {
            res.status(409).json({ error: 'El correo ya está registrado' });
        }
        else {
            res.status(500).json({ error: 'Error al crear usuario' });
        }
    }
});
router.put('/:id', auth_1.requireAuth, auth_1.requireAdmin, (req, res) => {
    const { id } = req.params;
    const { nombre, email, rol, activo } = req.body;
    const db = (0, db_1.getDb)();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) {
        res.status(404).json({ error: 'Usuario no encontrado' });
        return;
    }
    const rolMap = {
        Administrador: 'admin', Secretaria: 'secretaria', Docente: 'docente', Estudiante: 'estudiante',
    };
    const fields = [];
    const values = [];
    if (nombre) {
        fields.push('nombre = ?');
        values.push(nombre.trim());
    }
    if (email) {
        fields.push('email = ?');
        values.push(email.trim().toLowerCase());
    }
    if (rol) {
        fields.push('rol = ?', 'rol_display = ?');
        values.push(rolMap[rol] ?? 'docente', rol);
    }
    if (activo !== undefined) {
        fields.push('activo = ?');
        values.push(activo ? 1 : 0);
    }
    if (fields.length === 0) {
        res.status(400).json({ error: 'Nada que actualizar' });
        return;
    }
    values.push(id);
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    res.json(toRow(updated));
});
router.delete('/:id', auth_1.requireAuth, auth_1.requireAdmin, (req, res) => {
    const { id } = req.params;
    const db = (0, db_1.getDb)();
    const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
    if (result.changes === 0) {
        res.status(404).json({ error: 'Usuario no encontrado' });
        return;
    }
    res.json({ message: 'Usuario eliminado' });
});
exports.default = router;
