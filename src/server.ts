import "dotenv/config";
import app from "./app.js";

const PORT = parseInt(process.env.PORT ?? "5000", 10);

const server = app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║     Newsletter Agent -Backend       ║
╠══════════════════════════════════════╣
║  Port  : ${PORT}                        ║
║  Model : ${(process.env.GROQ_MODEL ?? "openai/gpt-oss-120b").slice(0, 24).padEnd(24)} ║
╚══════════════════════════════════════╝
`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
