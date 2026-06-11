import Anthropic from '@anthropic-ai/sdk'
import type { DetectedClient } from '../../shared/types'
import type { SecretStore } from './secrets'
import type { Catalog } from './catalog'

export interface Recommendation {
  title: string
  rationale: string
  serverIds: string[]
  clientIds: string[]
}

const MODEL = 'claude-opus-4-8'

/**
 * AI Advisor — turns a natural-language goal into a recommended set of servers
 * and target clients, grounded in the live catalog + detected clients. It only
 * RECOMMENDS; the caller turns the recommendation into a reviewable plan and the
 * user approves a diff before anything is written.
 */
export class AiAdvisor {
  constructor(
    private secrets: SecretStore,
    private catalog: Catalog
  ) {}

  isConfigured(): boolean {
    return this.secrets.hasApiKey()
  }

  async recommend(request: string, clients: DetectedClient[]): Promise<Recommendation> {
    const apiKey = this.secrets.getApiKey()
    if (!apiKey) throw new Error('No Anthropic API key configured. Add one in Settings.')

    const client = new Anthropic({ apiKey })
    const catalogBrief = this.catalog
      .all()
      .map((s) => `- ${s.id}: ${s.name} — ${s.description} [tags: ${s.tags.join(', ')}]`)
      .join('\n')
    const clientBrief = clients
      .filter((c) => c.installed)
      .map((c) => `- ${c.id}: ${c.name}`)
      .join('\n')

    const tool: Anthropic.Tool = {
      name: 'recommend_connections',
      description: 'Recommend which MCP servers to connect to which clients for the user goal.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short title for this recommendation' },
          rationale: { type: 'string', description: 'Why these servers serve the goal' },
          serverIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Catalog server ids to connect (must come from the catalog list)'
          },
          clientIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Client ids to connect them to (must come from the installed clients list)'
          }
        },
        required: ['title', 'rationale', 'serverIds', 'clientIds']
      }
    }

    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'recommend_connections' },
      messages: [
        {
          role: 'user',
          content:
            `User goal: "${request}"\n\n` +
            `Available MCP servers (choose only from these ids):\n${catalogBrief}\n\n` +
            `Installed clients (choose only from these ids):\n${clientBrief || '(none detected)'}\n\n` +
            `Recommend a focused set — prefer the few servers that best serve the goal.`
        }
      ]
    })

    const block = msg.content.find((b) => b.type === 'tool_use') as
      | Anthropic.ToolUseBlock
      | undefined
    if (!block) throw new Error('The model did not return a recommendation.')

    const input = block.input as Partial<Recommendation>
    const validServerIds = new Set(this.catalog.all().map((s) => s.id))
    const validClientIds = new Set(clients.map((c) => c.id))

    return {
      title: input.title ?? 'Recommended connections',
      rationale: input.rationale ?? '',
      serverIds: (input.serverIds ?? []).filter((id) => validServerIds.has(id)),
      clientIds: (input.clientIds ?? []).filter((id) => validClientIds.has(id))
    }
  }
}
