import "dotenv/config";
import { createApp } from "./app.js";
import { hasApiKey } from "./services/gemini.js";
import { hasMailKey } from "./services/mailer.js";

const PORT = Number(process.env.PORT || 3001);
const app = createApp();

app.listen(PORT, () => {
  console.log(`BudgetBrain server listening on http://localhost:${PORT}`);
  if (!hasApiKey()) {
    console.warn(
      "⚠ GEMINI_API_KEY not set — the app works, but AI categorization and suggestions will be unavailable. Copy server/.env.example to server/.env and add your key."
    );
  }
  if (!hasMailKey()) {
    console.warn(
      "⚠ RESEND_API_KEY not set — password reset links will be printed to this console instead of emailed. Copy server/.env.example to server/.env and add your key when you're ready."
    );
  }
});
