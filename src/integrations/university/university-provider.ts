import type { Campus, University } from "../../domain/entities.js";

export interface UniversityMatch {
  university: University;
  /** 1 = exact official-name hit, lower means an alias or fuzzy hit. */
  confidence: number;
}

export interface UniversityProvider {
  list(): University[];
  getById(id: string): University | null;
  /** Returns candidates ordered by confidence; empty when nothing plausible matched. */
  match(text: string): UniversityMatch[];
  getCampus(universityId: string, campusId: string): Campus | null;
}

/**
 * Campuses far enough apart that picking one silently would change which
 * apartments we recommend.
 */
export function requiresCampusChoice(university: University): boolean {
  return university.campuses.length > 1;
}
