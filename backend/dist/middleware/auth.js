"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
exports.requireAdmin = requireAdmin;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'No autorizado' });
        return;
    }
    const token = header.slice(7);
    try {
        const secret = process.env.JWT_SECRET;
        const payload = jsonwebtoken_1.default.verify(token, secret);
        req.user = payload;
        next();
    }
    catch {
        res.status(401).json({ error: 'Token inválido o expirado' });
    }
}
function requireAdmin(req, res, next) {
    if (req.user?.rol !== 'admin') {
        res.status(403).json({ error: 'Se requiere rol de administrador' });
        return;
    }
    next();
}
