import { env } from "../config/env.js";
import { createDatabase, getDatabase, type Database } from "../database/client.js";
import { createRepositories, type Repositories } from "../database/repositories/index.js";
import { LinqClient, type LinqAdapter } from "../integrations/linq/linq-client.js";
import { MockHousingProvider } from "../integrations/housing/mock-housing-provider.js";
import { QasaHousingProvider } from "../integrations/housing/qasa-housing-provider.js";
import type { HousingProvider } from "../integrations/housing/housing-provider.js";
import { MockLlmProvider } from "../integrations/llm/mock-llm-provider.js";
import { AnthropicLlmProvider } from "../integrations/llm/anthropic-llm-provider.js";
import type { LlmProvider } from "../integrations/llm/llm-provider.js";
import { StaticUniversityProvider } from "../integrations/university/static-university-provider.js";
import type { UniversityProvider } from "../integrations/university/university-provider.js";
import { HousingContactService, type ContactService } from "../integrations/contact/housing-contact-service.js";
import { SearchService } from "./search-service.js";
import { PresentationService } from "./presentation-service.js";
import { ApplicationService } from "./application-service.js";
import { ReactionService } from "./reaction-service.js";
import { ConversationService } from "./conversation-service.js";
import { RenewalService } from "./renewal-service.js";
import { ExperienceService } from "./experience-service.js";

export interface Container {
  db: Database;
  repos: Repositories;
  linq: LinqAdapter;
  housing: HousingProvider;
  llm: LlmProvider;
  universities: UniversityProvider;
  contact: ContactService;
  search: SearchService;
  presentation: PresentationService;
  applications: ApplicationService;
  reactions: ReactionService;
  conversation: ConversationService;
  renewal: RenewalService;
  experience: ExperienceService;
}

export interface ContainerOverrides {
  db?: Database;
  linq?: LinqAdapter;
  housing?: HousingProvider;
  llm?: LlmProvider;
  universities?: UniversityProvider;
  contact?: ContactService;
}

function selectHousingProvider(name: string): HousingProvider {
  return name === "qasa" ? new QasaHousingProvider() : new MockHousingProvider();
}

function selectLlmProvider(name: string): LlmProvider {
  return name === "anthropic" ? new AnthropicLlmProvider() : new MockLlmProvider();
}

/** Wires the object graph. Tests pass overrides instead of touching globals. */
export function createContainer(overrides: ContainerOverrides = {}): Container {
  const db = overrides.db ?? getDatabase();
  const repos = createRepositories(db);

  const linq = overrides.linq ?? new LinqClient({ outbound: repos.outbound });
  const housing = overrides.housing ?? selectHousingProvider(env.HOUSING_PROVIDER);
  const llm = overrides.llm ?? selectLlmProvider(env.LLM_PROVIDER);
  const universities = overrides.universities ?? new StaticUniversityProvider();
  const contact = overrides.contact ?? new HousingContactService(housing);

  const search = new SearchService(repos, housing, universities);
  const presentation = new PresentationService(repos, linq);
  const applications = new ApplicationService(repos, contact, llm, universities);
  const reactions = new ReactionService(repos);
  const renewal = new RenewalService(repos, linq);
  const experience = new ExperienceService(repos, linq);
  const conversation = new ConversationService({
    repos,
    linq,
    llm,
    universities,
    search,
    presentation,
    applications,
    reactions,
  });

  return {
    db, repos, linq, housing, llm, universities, contact,
    search, presentation, applications, reactions, conversation, renewal, experience,
  };
}

export { createDatabase };
