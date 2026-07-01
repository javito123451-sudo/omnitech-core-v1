import OpenAI from "openai";
import { logger } from "../lib/logger";

export interface AdsCampaignInput {
  businessName: string;
  businessType: string;
  product: string;
  targetAudience: string;
  goal: string;
  budget: number;
  platforms: string[];
}

export interface AdsCampaignContent {
  strategy: string;
  headlines: string[];
  primaryText: string;
  callsToAction: string[];
  imagePrompts: string[];
  videoPrompts: string[];
  voiceoverScript: string;
  hashtags: string[];
  recommendedAudience: string;
  recommendedBudget: string;
  tips: string[];
}

export interface AdsAiProvider {
  providerName: string;
  generateCampaignContent(input: AdsCampaignInput): Promise<AdsCampaignContent>;
}

class OpenAIAdsProvider implements AdsAiProvider {
  readonly providerName = "openai";
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: process.env["OPENAI_API_KEY"] });
  }

  async generateCampaignContent(input: AdsCampaignInput): Promise<AdsCampaignContent> {
    const goalLabel: Record<string, string> = {
      sales:     "ventas directas",
      leads:     "captación de leads",
      traffic:   "tráfico web",
      awareness: "reconocimiento de marca",
    };
    const platformList = input.platforms.join(", ");
    const goalText     = goalLabel[input.goal] ?? input.goal;

    const prompt = `Eres un experto en publicidad digital con más de 15 años de experiencia creando campañas exitosas en redes sociales y buscadores.

Crea una estrategia de publicidad completa y detallada para:
- Empresa: ${input.businessName}
- Sector: ${input.businessType}
- Producto/Servicio: ${input.product}
- Audiencia objetivo: ${input.targetAudience}
- Objetivo: ${goalText}
- Presupuesto: ${input.budget}€
- Plataformas: ${platformList || "todas las principales"}

Responde EXCLUSIVAMENTE con un JSON válido con esta estructura exacta (sin markdown, sin texto extra):
{
  "strategy": "estrategia general detallada en 3-4 párrafos con enfoque en el objetivo y plataformas elegidas",
  "headlines": ["titular 1", "titular 2", "titular 3", "titular 4", "titular 5"],
  "primaryText": "texto principal del anuncio de 150-200 palabras, persuasivo y orientado a conversión",
  "callsToAction": ["CTA 1", "CTA 2", "CTA 3", "CTA 4"],
  "imagePrompts": ["descripción detallada para generar imagen 1 con estilo y composición", "descripción imagen 2", "descripción imagen 3"],
  "videoPrompts": ["concepto video 1: escena, duración, música, tono emocional", "concepto video 2"],
  "voiceoverScript": "script completo de locución para video de 60-90 segundos, con pausas marcadas",
  "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3", "#hashtag4", "#hashtag5", "#hashtag6", "#hashtag7", "#hashtag8"],
  "recommendedAudience": "descripción detallada: edad, género, intereses, comportamientos, ubicación geográfica, nivel socioeconómico",
  "recommendedBudget": "distribución del presupuesto por plataforma con porcentajes y justificación estratégica",
  "tips": ["consejo estratégico 1", "consejo estratégico 2", "consejo estratégico 3", "consejo estratégico 4", "consejo estratégico 5"]
}

Todo el contenido debe estar en español, ser persuasivo y optimizado para maximizar el ROI.`;

    const response = await this.client.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.8,
      max_tokens: 4000,
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    try {
      return JSON.parse(raw) as AdsCampaignContent;
    } catch {
      logger.error({ raw }, "[AdsAI] Failed to parse AI response");
      throw new Error("AI response could not be parsed");
    }
  }
}

let _provider: AdsAiProvider | null = null;

export function getAdsAiProvider(): AdsAiProvider {
  if (!_provider) _provider = new OpenAIAdsProvider();
  return _provider;
}

export function registerAdsAiProvider(provider: AdsAiProvider): void {
  _provider = provider;
}
