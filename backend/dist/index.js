"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const db_1 = require("./db");
const auth_1 = __importDefault(require("./routes/auth"));
const users_1 = __importDefault(require("./routes/users"));
const programs_1 = __importDefault(require("./routes/programs"));
const teachers_1 = __importDefault(require("./routes/teachers"));
const spaces_1 = __importDefault(require("./routes/spaces"));
const groups_1 = __importDefault(require("./routes/groups"));
const schedules_1 = __importDefault(require("./routes/schedules"));
const app = (0, express_1.default)();
const PORT = process.env.PORT ?? 3001;
app.use((0, cors_1.default)({
    origin: ['http://localhost:5173', 'http://localhost:4173'],
    credentials: true,
}));
app.use(express_1.default.json());
(0, db_1.initDb)();
app.use('/api/auth', auth_1.default);
app.use('/api/users', users_1.default);
app.use('/api/programs', programs_1.default);
app.use('/api/teachers', teachers_1.default);
app.use('/api/spaces', spaces_1.default);
app.use('/api/groups', groups_1.default);
app.use('/api/schedules', schedules_1.default);
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.listen(PORT, () => {
    console.log(`AulaLibre Backend → http://localhost:${PORT}`);
});
