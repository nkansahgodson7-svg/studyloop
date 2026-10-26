import type { Client } from '@libsql/client';
import { createCard } from './cards';
import { ingestTextSource } from './ingest/ingest';
import { createNotebook, deleteNotebook, listNotebooks } from './notebooks';

interface SeedSource {
  kind: 'pdf' | 'youtube' | 'text';
  title: string;
  meta: string;
  text: string;
}

interface SeedCard {
  front: string;
  back: string;
  source: string;
  state: number;
  due: number;
}

interface SeedNotebook {
  title: string;
  sources: SeedSource[];
  cards: SeedCard[];
  generated: Array<{ front: string; back: string; source: string }>;
}

const DAY_MS = 86_400_000;

export const DEMO_SEED: SeedNotebook[] = [
  {
    title: 'Organic Chemistry',
    sources: [
      {
        kind: 'pdf',
        title: 'Lecture 04 — Alkenes.pdf',
        meta: '24 pages · 86 chunks',
        text: 'Alkenes are hydrocarbons containing a carbon-carbon double bond. The double bond consists of a sigma bond and a pi bond, making it electron rich and reactive toward electrophiles. Markovnikov rule: in the addition of HX to an unsymmetrical alkene, the hydrogen atom adds to the carbon with more hydrogens and the halide to the more substituted carbon. Propene plus HBr gives 2-bromopropane as the major product because the secondary carbocation intermediate is more stable than the primary one. Electrophilic addition proceeds through a carbocation intermediate; stability follows tertiary > secondary > primary due to hyperconjugation and inductive donation. Carbocation rearrangements such as 1,2-hydride shifts can convert a less stable carbocation into a more stable one before the nucleophile attacks. With peroxides, HBr adds anti-Markovnikov through a radical chain mechanism, placing bromine on the less substituted carbon.'
      },
      {
        kind: 'text',
        title: 'Reaction mechanisms — summary',
        meta: '12 chunks',
        text: 'Curly arrows show the movement of an electron pair from an electron-rich site, such as a pi bond or lone pair, to an electron-poor site, such as an electrophile. An electrophile is an electron-poor species that accepts an electron pair from a nucleophile; examples include H+, Br+ and carbocations. Alkenes undergo addition rather than substitution because the pi bond is electron rich and breaks readily, allowing two new sigma bonds to form across the double bond while keeping the carbon skeleton intact. Curly arrows never show the movement of atoms, only of electron pairs, and they always start from a bond or a lone pair.'
      },
      {
        kind: 'youtube',
        title: 'Khan Academy — Electrophilic addition',
        meta: '18 min · 41 chunks',
        text: 'In this lesson we walk through electrophilic addition to alkenes step by step. The pi bond attacks the proton of a strong acid, forming the most stable carbocation intermediate, and then the halide ion attacks the carbocation. The most substituted alkene is the most stable one because hyperconjugation from neighboring C-H bonds stabilizes the pi bond and reduces steric strain. Anti-Markovnikov addition of HBr happens only in the presence of peroxides, which start a radical chain reaction and reverse the usual regiochemistry. Worked example: propene treated with HBr alone yields 2-bromopropane; with HBr and peroxides it yields 1-bromopropane.'
      }
    ],
    cards: [
      {
        front: "What is Markovnikov's rule?",
        back: 'In HX addition to an alkene, hydrogen adds to the carbon with more hydrogens, and the halogen adds to the more substituted carbon.',
        source: 'Lecture 04 — Alkenes.pdf',
        state: 3,
        due: 3
      },
      {
        front: 'Which intermediate forms during electrophilic addition to alkenes?',
        back: 'A carbocation intermediate. Stability follows 3° > 2° > 1°, which decides the major product.',
        source: 'Reaction mechanisms — summary',
        state: 1,
        due: -0.03
      },
      {
        front: 'Define an electrophile.',
        back: 'An electron-poor species that accepts an electron pair from a nucleophile.',
        source: 'Lecture 04 — Alkenes.pdf',
        state: 2,
        due: 1
      },
      {
        front: 'Why do alkenes undergo addition rather than substitution?',
        back: 'The C=C π bond is electron-rich and breaks readily, letting two new σ bonds form across the double bond.',
        source: 'Reaction mechanisms — summary',
        state: 0,
        due: -1
      },
      {
        front: 'What is the product of HBr addition to propene without peroxides?',
        back: '2-bromopropane, formed via the more stable secondary carbocation.',
        source: 'Lecture 04 — Alkenes.pdf',
        state: 2,
        due: -0.15
      },
      {
        front: 'What does a curly arrow represent in a mechanism?',
        back: 'The movement of an electron pair from an electron-rich site to an electron-poor site.',
        source: 'Khan Academy — Electrophilic addition',
        state: 3,
        due: -0.05
      }
    ],
    generated: [
      {
        front: 'Which alkene is most stable?',
        back: 'The most substituted alkene — hyperconjugation stabilizes the π bond and steric strain is reduced.',
        source: 'Lecture 04 — Alkenes.pdf'
      },
      {
        front: 'What is a carbocation rearrangement?',
        back: 'A 1,2-hydride or alkyl shift that converts a less stable carbocation into a more stable one.',
        source: 'Reaction mechanisms — summary'
      },
      {
        front: 'Which reagent gives anti-Markovnikov HBr addition?',
        back: 'HBr with peroxides, via a radical mechanism, places Br on the less substituted carbon.',
        source: 'Khan Academy — Electrophilic addition'
      }
    ]
  },
  {
    title: 'World History',
    sources: [
      {
        kind: 'pdf',
        title: 'Ch. 12 — The Great War.pdf',
        meta: '31 pages · 104 chunks',
        text: 'The assassination of Archduke Franz Ferdinand in Sarajevo on 28 June 1914 triggered the July Crisis and the start of World War I. The system of alliances pulled the great powers into a continental war within weeks. The Treaty of Versailles, signed in 1919, included Article 231, the war guilt clause, which assigned sole responsibility for the war to Germany and its allies and justified reparations. The League of Nations was created to prevent future wars, but it had no enforcement power, the United States never joined, and major powers were excluded or withdrew, so it failed to prevent World War II. The Marshall Plan, launched in 1948, provided more than 12 billion dollars to rebuild Western European economies after World War II.'
      },
      {
        kind: 'text',
        title: 'Treaty of Versailles notes',
        meta: '9 chunks',
        text: 'The Treaty of Versailles was signed on 28 June 1919, exactly five years after the assassination in Sarajevo, in the Hall of Mirrors at the Palace of Versailles. Article 231, the war guilt clause, made Germany accept responsibility for the war and became the legal basis for reparations. Germany lost territory, was limited to an army of 100,000 men, and had to pay reparations set in 1921. The Dawes Plan of 1924 was a United States loan program that rescheduled German reparations payments and stabilized the Weimar economy.'
      },
      {
        kind: 'youtube',
        title: 'Crash Course — WWI',
        meta: '13 min · 33 chunks',
        text: 'World War I was the first total war: a conflict that mobilized an entire society and its economy, not just its military. Civilians were drawn into the war effort through factories, rationing and propaganda. The war ended with the armistice of 11 November 1918, and the peace settlement redrew the map of Europe. The Marshall Plan, formally the European Recovery Program, ran from 1948 to 1951 and is credited with kick-starting the postwar recovery of Western Europe.'
      }
    ],
    cards: [
      {
        front: 'What event triggered the start of World War I?',
        back: 'The assassination of Archduke Franz Ferdinand in Sarajevo on 28 June 1914, followed by the July Crisis.',
        source: 'Ch. 12 — The Great War.pdf',
        state: 3,
        due: 2
      },
      {
        front: 'What did Article 231 of the Treaty of Versailles do?',
        back: 'The war guilt clause assigned sole responsibility for the war to Germany and its allies, justifying reparations.',
        source: 'Treaty of Versailles notes',
        state: 1,
        due: -1
      },
      {
        front: 'What was the Marshall Plan?',
        back: 'A US program (1948–1951) providing more than $12 billion to rebuild Western European economies after WWII.',
        source: 'Crash Course — WWI',
        state: 2,
        due: 4
      },
      {
        front: 'Why did the League of Nations fail to prevent WWII?',
        back: 'It had no enforcement power, the US never joined, and major powers were excluded or withdrew.',
        source: 'Ch. 12 — The Great War.pdf',
        state: 1,
        due: -0.2
      }
    ],
    generated: [
      {
        front: 'When was the Treaty of Versailles signed?',
        back: '28 June 1919, in the Hall of Mirrors at the Palace of Versailles.',
        source: 'Treaty of Versailles notes'
      },
      {
        front: 'What was the Dawes Plan?',
        back: 'A 1924 US loan program that rescheduled German reparations and stabilized the Weimar economy.',
        source: 'Ch. 12 — The Great War.pdf'
      },
      {
        front: 'Define total war.',
        back: "Conflict that mobilizes a society's entire population and economy, not just its military.",
        source: 'Crash Course — WWI'
      }
    ]
  },
  {
    title: 'Calculus II',
    sources: [
      {
        kind: 'pdf',
        title: 'Stewart §7.1 — Integration by parts.pdf',
        meta: '18 pages · 61 chunks',
        text: 'Integration by parts is the product rule in reverse: the integral of u dv equals u times v minus the integral of v du. Choose u so that its derivative is simpler, and dv so that v is easy to integrate. Example: the integral of ln(x) dx equals x ln x minus x plus C, using u = ln x and dv = dx. Another classic: the integral of tan(x) dx equals minus ln of the absolute value of cos x, equivalently ln of the absolute value of sec x, plus C. Integration by parts is essential for integrals involving products of algebraic, exponential, logarithmic and trigonometric functions.'
      },
      {
        kind: 'text',
        title: 'Series convergence cheatsheet',
        meta: '7 chunks',
        text: 'A series is conditionally convergent when the series of a-n converges but the series of absolute values diverges; the alternating harmonic series is the classic example. The alternating series test: if b-n decreases monotonically to zero, then the alternating sum converges. The ratio test: compute the limit L of the absolute value of the ratio of successive terms; when L is less than 1 the series converges absolutely, when L is greater than 1 it diverges, and when L equals 1 the test is inconclusive. A p-series, the sum of 1 over n to the p, converges when p is greater than 1 and diverges when p is less than or equal to 1.'
      }
    ],
    cards: [
      {
        front: 'State the integration by parts formula.',
        back: '∫u dv = uv − ∫v du. Choose u so that du is simpler, and dv so that v is easy to integrate.',
        source: 'Stewart §7.1 — Integration by parts.pdf',
        state: 3,
        due: 6
      },
      {
        front: 'When is a series conditionally convergent?',
        back: 'When ∑aₙ converges but ∑|aₙ| diverges — for example the alternating harmonic series.',
        source: 'Series convergence cheatsheet',
        state: 2,
        due: -0.1
      },
      {
        front: 'What does the ratio test conclude when L < 1?',
        back: 'The series converges absolutely. When L > 1 it diverges, and L = 1 is inconclusive.',
        source: 'Series convergence cheatsheet',
        state: 1,
        due: -1
      },
      {
        front: 'Integrate ∫ln(x) dx.',
        back: 'x ln x − x + C, using integration by parts with u = ln x and dv = dx.',
        source: 'Stewart §7.1 — Integration by parts.pdf',
        state: 2,
        due: 2
      }
    ],
    generated: [
      {
        front: 'What is ∫tan(x) dx?',
        back: '−ln|cos x| + C, equivalently ln|sec x| + C.',
        source: 'Stewart §7.1 — Integration by parts.pdf'
      },
      {
        front: 'State the alternating series test.',
        back: 'If bₙ decreases monotonically to 0, then ∑(−1)ⁿbₙ converges.',
        source: 'Series convergence cheatsheet'
      },
      {
        front: 'When does a p-series converge?',
        back: '∑1/nᵖ converges when p > 1 and diverges when p ≤ 1.',
        source: 'Series convergence cheatsheet'
      }
    ]
  }
];

export interface ResetResult {
  notebooks: number;
  sources: number;
  cards: number;
}

export async function resetDemoData(db: Client, userId: number, now = new Date()): Promise<ResetResult> {
  const existing = await listNotebooks(db, userId);
  for (const notebook of existing) {
    await deleteNotebook(db, userId, notebook.id);
  }

  let sourceCount = 0;
  let cardCount = 0;

  for (const seed of DEMO_SEED) {
    const notebook = await createNotebook(db, userId, seed.title);
    const sourceIds = new Map<string, number>();
    for (const source of seed.sources) {
      const created = await ingestTextSource(db, {
        notebookId: notebook.id,
        userId,
        title: source.title,
        kind: source.kind,
        text: source.text,
        meta: source.meta
      });
      sourceIds.set(source.title, created.id);
      sourceCount += 1;
    }
    const baseCards = [...seed.cards, ...seed.generated.map((card) => ({ ...card, state: 0, due: 0, generated: true }))];
    for (const card of baseCards) {
      const created = await createCard(db, notebook.id, {
        sourceId: sourceIds.get(card.source) ?? null,
        front: card.front,
        back: card.back,
        createdAt: now,
        generated: 'generated' in card && card.generated === true
      });
      cardCount += 1;
      if (card.state > 0 || card.due !== 0) {
        const due = new Date(now.getTime() + card.due * DAY_MS).toISOString();
        await db.execute({
          sql: 'UPDATE reviews SET state = ?, due = ?, stability = ?, difficulty = 5, reps = ?, lapses = 0, last_graded = ? WHERE card_id = ?',
          args: [card.state, due, Math.max(1, card.state * 2), card.state, now.toISOString(), created.id]
        });
      }
    }
  }

  return { notebooks: DEMO_SEED.length, sources: sourceCount, cards: cardCount };
}
