/**
 * Smoke serveur pour queryAgent. Variables d'environnement uniquement.
 * Ne pas exécuter dans un navigateur. Ne journalise pas le jeton.
 *
 * Importe le point d'entrée public `@selvren/sdk` (dist empaqueté), pas les
 * sources du monorepo. Construire le paquet d'abord :
 *   cd modules/selvren-sdk && bun run build
 *
 * Depuis ce dépôt (Bun), une fois `@selvren/sdk` résolu (workspace:* et
 * dist construit) :
 *   bun examples/selvren-build-kit/scripts/query-agent.ts
 *
 * Intégrateur : `npm install` de l'archive `selvren-sdk-0.1.0.tgz`.
 */
import { SelvrenIntegrationClient } from "@selvren/sdk";

const client = new SelvrenIntegrationClient({
  baseUrl: env("SELVREN_API_URL"),
  tenantId: env("SELVREN_INTEGRATION_TENANT"),
  tokenProvider: () => env("SELVREN_INTEGRATION_TOKEN"),
});

const agentId = env("SELVREN_AGENT_ID");
const clientRequestId = process.env.SELVREN_CLIENT_REQUEST_ID?.trim() || crypto.randomUUID();
const question = process.env.SELVREN_QUESTION?.trim() || "Quels équipements sont requis ?";

const answer = await client.queryAgent(agentId, {
  client_request_id: clientRequestId,
  question,
  language: "fr",
  revision: "published",
});

process.stdout.write(
  `${JSON.stringify(
    {
      client_request_id: clientRequestId,
      agent_id: answer.agent_id,
      agent_revision_id: answer.agent_revision_id,
      agent_revision_number: answer.agent_revision_number,
      request_id: answer.request_id,
      outcome: answer.outcome,
      answer: answer.answer,
      citations: answer.citations.map((citation) => ({
        id: citation.id,
        document_name: citation.document_name,
        excerpt: citation.excerpt,
        location: citation.location,
      })),
    },
    null,
    2,
  )}\n`,
);

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
