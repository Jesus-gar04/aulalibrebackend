import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { initDb } from './db'
import authRoutes from './routes/auth'
import userRoutes from './routes/users'
import programRoutes from './routes/programs'
import teacherRoutes from './routes/teachers'
import spaceRoutes from './routes/spaces'
import groupRoutes from './routes/groups'
import scheduleRoutes from './routes/schedules'

const app = express()
const PORT = process.env.PORT ?? 3001

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:4173')
  .split(',')
  .map((o) => o.trim())

app.use(cors({
  origin: ALLOWED_ORIGINS,
  credentials: true,
}))
app.use(express.json())

initDb()

app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes)
app.use('/api/programs', programRoutes)
app.use('/api/teachers', teacherRoutes)
app.use('/api/spaces', spaceRoutes)
app.use('/api/groups', groupRoutes)
app.use('/api/schedules', scheduleRoutes)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.listen(PORT, () => {
  console.log(`AulaLibre Backend → http://localhost:${PORT}`)
})
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { initDb } from './db'
import authRoutes from './routes/auth'
import userRoutes from './routes/users'
import programRoutes from './routes/programs'
import teacherRoutes from './routes/teachers'
import spaceRoutes from './routes/spaces'
import groupRoutes from './routes/groups'
import scheduleRoutes from './routes/schedules'

const app = express()
const PORT = process.env.PORT ?? 3001

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:4173')
  .split(',')
  .map((o) => o.trim())

app.use(cors({
  origin: ALLOWED_ORIGINS,
  credentials: true,
}))
app.use(express.json())

initDb()

app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes)
app.use('/api/programs', programRoutes)
app.use('/api/teachers', teacherRoutes)
app.use('/api/spaces', spaceRoutes)
app.use('/api/groups', groupRoutes)
app.use('/api/schedules', scheduleRoutes)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.listen(PORT, () => {
  console.log(`AulaLibre Backend → http://localhost:${PORT}`)
})
