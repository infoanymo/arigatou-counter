import { readFile } from "node:fs/promises";

const authConfigEndpoint = "https://api.supabase.com/v1/projects";
const inviteSubject = "オキアリに招待されました";
const templatePath = new URL("../supabase/templates/invite.html", import.meta.url);

async function readEnvFile(path) {
  const text = await readFile(path, "utf8").catch(() => "");
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const [key, ...value] = line.split("=");
        return [key.trim(), value.join("=").trim().replace(/^["']|["']$/g, "")];
      }),
  );
}

async function inferProjectRef() {
  if (process.env.PROJECT_REF?.trim()) return process.env.PROJECT_REF.trim();

  const env = await readEnvFile(new URL("../.env.local", import.meta.url));
  const url = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const match = url.match(/^https:\/\/([^.]+)\.supabase\.co\/?$/);
  return match?.[1] ?? "";
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();
if (!accessToken) {
  fail("SUPABASE_ACCESS_TOKEN is required. Create one in Supabase Dashboard > Account > Access Tokens.");
}

const projectRef = await inferProjectRef();
if (!projectRef) {
  fail("PROJECT_REF is required, or set VITE_SUPABASE_URL in .env.local.");
}

const inviteContent = await readFile(templatePath, "utf8");
const response = await fetch(`${authConfigEndpoint}/${projectRef}/config/auth`, {
  method: "PATCH",
  headers: {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    mailer_subjects_invite: inviteSubject,
    mailer_templates_invite_content: inviteContent,
  }),
});

const responseText = await response.text();
if (!response.ok) {
  fail(`Failed to update invite email template: ${response.status} ${responseText}`);
}

console.log(`Updated invite email template for ${projectRef}.`);
