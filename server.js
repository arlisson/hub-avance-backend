import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import authRoutes from "./src/routes/auth.routes.js";
import profileRoutes from "./src/routes/profile.routes.js";
import adminUsersRoutes from "./src/routes/admin.users.routes.js";
import agentRoutes from "./src/routes/agent.routes.js";
import avaliacoesRoutes from "./src/routes/avaliacoes.routes.js";
import leadsRoutes from "./src/routes/leads.routes.js";
import adminLeadsRoutes from "./src/routes/admin.leads.routes.js";


dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors({
  origin: [
    "https://avancevip.net.br",
    "https://wheat-magpie-180957.hostingersite.com",
  ],
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Authorization", "Content-Type"],
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

app.use("/api", authRoutes);
app.use("/api", profileRoutes);
app.use("/api", adminUsersRoutes);

app.use("/api", agentRoutes);

app.use("/api", avaliacoesRoutes);


app.use("/api", leadsRoutes);
app.use("/api", adminLeadsRoutes);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Servidor funcionando" });
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Servidor rodando na porta ${process.env.PORT || 3000}`);
});