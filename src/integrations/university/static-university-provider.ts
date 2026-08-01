import type { Campus, University } from "../../domain/entities.js";
import type { UniversityMatch, UniversityProvider } from "./university-provider.js";

export const UNIVERSITIES: University[] = [
  {
    id: "lund",
    officialName: "Lund University",
    aliases: ["lund", "lunds universitet", "lu", "lund uni"],
    city: "Lund",
    campuses: [
      {
        id: "lund-central",
        name: "Lund city campus",
        address: "Paradisgatan 2, Lund",
        coordinates: { latitude: 55.7047, longitude: 13.1910 },
      },
      {
        id: "lund-lth",
        name: "LTH (Faculty of Engineering)",
        address: "John Ericssons väg 3, Lund",
        coordinates: { latitude: 55.7118, longitude: 13.2100 },
      },
    ],
  },
  {
    id: "malmo",
    officialName: "Malmö University",
    aliases: ["malmo", "malmö", "malmö universitet", "mau"],
    city: "Malmö",
    campuses: [
      {
        id: "malmo-niagara",
        name: "Niagara",
        address: "Nordenskiöldsgatan 1, Malmö",
        coordinates: { latitude: 55.6050, longitude: 12.9976 },
      },
    ],
  },
  {
    id: "stockholm",
    officialName: "Stockholm University",
    aliases: ["stockholm", "stockholms universitet", "su"],
    city: "Stockholm",
    campuses: [
      {
        id: "stockholm-frescati",
        name: "Frescati",
        address: "Universitetsvägen 10, Stockholm",
        coordinates: { latitude: 59.3650, longitude: 18.0587 },
      },
    ],
  },
  {
    id: "kth",
    officialName: "KTH Royal Institute of Technology",
    aliases: ["kth", "royal institute of technology", "kungliga tekniska högskolan"],
    city: "Stockholm",
    campuses: [
      {
        id: "kth-valhallavagen",
        name: "Campus Valhallavägen",
        address: "Brinellvägen 8, Stockholm",
        coordinates: { latitude: 59.3470, longitude: 18.0730 },
      },
      {
        id: "kth-kista",
        name: "Campus Kista",
        address: "Electrum, Kistagången 16, Kista",
        coordinates: { latitude: 59.4040, longitude: 17.9480 },
      },
    ],
  },
  {
    id: "karolinska",
    officialName: "Karolinska Institutet",
    aliases: ["karolinska", "ki", "karolinska institute"],
    city: "Stockholm",
    campuses: [
      {
        id: "ki-solna",
        name: "Campus Solna",
        address: "Solnavägen 1, Solna",
        coordinates: { latitude: 59.3490, longitude: 18.0230 },
      },
      {
        id: "ki-flemingsberg",
        name: "Campus Flemingsberg",
        address: "Alfred Nobels Allé 8, Huddinge",
        coordinates: { latitude: 59.2210, longitude: 17.9400 },
      },
    ],
  },
  {
    id: "uppsala",
    officialName: "Uppsala University",
    aliases: ["uppsala", "uppsala universitet", "uu"],
    city: "Uppsala",
    campuses: [
      {
        id: "uppsala-english-park",
        name: "English Park Campus",
        address: "Thunbergsvägen 3, Uppsala",
        coordinates: { latitude: 59.8590, longitude: 17.6300 },
      },
    ],
  },
  {
    id: "gothenburg",
    officialName: "University of Gothenburg",
    aliases: ["gothenburg", "göteborg", "göteborgs universitet", "gu"],
    city: "Gothenburg",
    campuses: [
      {
        id: "gu-vasaparken",
        name: "Campus Vasaparken",
        address: "Universitetsplatsen 1, Göteborg",
        coordinates: { latitude: 57.6970, longitude: 11.9740 },
      },
    ],
  },
  {
    id: "chalmers",
    officialName: "Chalmers University of Technology",
    aliases: ["chalmers", "chalmers tekniska högskola"],
    city: "Gothenburg",
    campuses: [
      {
        id: "chalmers-johanneberg",
        name: "Campus Johanneberg",
        address: "Chalmersplatsen 4, Göteborg",
        coordinates: { latitude: 57.6890, longitude: 11.9780 },
      },
      {
        id: "chalmers-lindholmen",
        name: "Campus Lindholmen",
        address: "Lindholmspiren 3, Göteborg",
        coordinates: { latitude: 57.7070, longitude: 11.9380 },
      },
    ],
  },
  {
    id: "linkoping",
    officialName: "Linköping University",
    aliases: ["linkoping", "linköping", "liu", "linköpings universitet"],
    city: "Linköping",
    campuses: [
      {
        id: "liu-valla",
        name: "Campus Valla",
        address: "Campus Valla, Linköping",
        coordinates: { latitude: 58.3980, longitude: 15.5760 },
      },
    ],
  },
  {
    id: "umea",
    officialName: "Umeå University",
    aliases: ["umea", "umeå", "umeå universitet", "umu"],
    city: "Umeå",
    campuses: [
      {
        id: "umu-campus",
        name: "Umeå Campus",
        address: "Universitetstorget 4, Umeå",
        coordinates: { latitude: 63.8200, longitude: 20.3080 },
      },
    ],
  },
];

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export class StaticUniversityProvider implements UniversityProvider {
  private readonly universities: University[];

  constructor(universities: University[] = UNIVERSITIES) {
    this.universities = universities;
  }

  list(): University[] {
    return this.universities;
  }

  getById(id: string): University | null {
    return this.universities.find((u) => u.id === id) ?? null;
  }

  getCampus(universityId: string, campusId: string): Campus | null {
    return this.getById(universityId)?.campuses.find((c) => c.id === campusId) ?? null;
  }

  match(text: string): UniversityMatch[] {
    const haystack = normalize(text);
    if (!haystack) return [];

    const matches: UniversityMatch[] = [];
    for (const university of this.universities) {
      const official = normalize(university.officialName);
      if (haystack.includes(official)) {
        matches.push({ university, confidence: 1 });
        continue;
      }

      // Longest alias first, so "malmö universitet" wins over bare "malmö".
      const aliases = [...university.aliases].sort((a, b) => b.length - a.length);
      let best = 0;
      for (const alias of aliases) {
        const normalizedAlias = normalize(alias);
        if (!normalizedAlias) continue;
        const isWord = new RegExp(`(^|\\s)${escapeRegExp(normalizedAlias)}($|\\s)`).test(haystack);
        if (isWord) {
          // Two-letter abbreviations are weak evidence on their own.
          best = Math.max(best, normalizedAlias.length <= 2 ? 0.5 : 0.85);
        }
      }
      if (best > 0) matches.push({ university, confidence: best });
    }

    return matches.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return a.university.id.localeCompare(b.university.id);
    });
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const universityProvider = new StaticUniversityProvider();
