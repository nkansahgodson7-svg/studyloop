window.SL = window.SL || {};

(function (SL) {
  "use strict";

  SL.NOTEBOOK_CARDS = {
    "Organic Chemistry": [
      {
        front: "What is Markovnikov's rule?",
        back: "In HX addition to an alkene, hydrogen adds to the carbon with more hydrogens, and the halogen adds to the more substituted carbon.",
        source: "Lecture 04 — Alkenes.pdf",
        state: 3,
        due: 3,
      },
      {
        front: "Which intermediate forms during electrophilic addition to alkenes?",
        back: "A carbocation intermediate. Stability follows 3° > 2° > 1°, which decides the major product.",
        source: "Reaction mechanisms — summary",
        state: 1,
        due: -0.03,
      },
      {
        front: "Define an electrophile.",
        back: "An electron-poor species that accepts an electron pair from a nucleophile.",
        source: "Lecture 04 — Alkenes.pdf",
        state: 2,
        due: 1,
      },
      {
        front: "Why do alkenes undergo addition rather than substitution?",
        back: "The C=C π bond is electron-rich and breaks readily, letting two new σ bonds form across the double bond.",
        source: "Reaction mechanisms — summary",
        state: 0,
        due: -1,
      },
      {
        front: "What is the product of HBr addition to propene without peroxides?",
        back: "2-bromopropane, formed via the more stable secondary carbocation.",
        source: "Lecture 04 — Alkenes.pdf",
        state: 2,
        due: -0.15,
      },
      {
        front: "What does a curly arrow represent in a mechanism?",
        back: "The movement of an electron pair from an electron-rich site to an electron-poor site.",
        source: "Khan Academy — Electrophilic addition",
        state: 3,
        due: -0.05,
      },
    ],
    "World History": [
      {
        front: "What event triggered the start of World War I?",
        back: "The assassination of Archduke Franz Ferdinand in Sarajevo on 28 June 1914, followed by the July Crisis.",
        source: "Ch. 12 — The Great War.pdf",
        state: 3,
        due: 2,
      },
      {
        front: "What did Article 231 of the Treaty of Versailles do?",
        back: "The war guilt clause assigned sole responsibility for the war to Germany and its allies, justifying reparations.",
        source: "Treaty of Versailles notes",
        state: 1,
        due: -1,
      },
      {
        front: "What was the Marshall Plan?",
        back: "A US program (1948–1951) providing more than $12 billion to rebuild Western European economies after WWII.",
        source: "Crash Course — WWI",
        state: 2,
        due: 4,
      },
      {
        front: "Why did the League of Nations fail to prevent WWII?",
        back: "It had no enforcement power, the US never joined, and major powers were excluded or withdrew.",
        source: "Ch. 12 — The Great War.pdf",
        state: 1,
        due: -0.2,
      },
    ],
    "Calculus II": [
      {
        front: "State the integration by parts formula.",
        back: "∫u dv = uv − ∫v du. Choose u so that du is simpler, and dv so that v is easy to integrate.",
        source: "Stewart §7.1 — Integration by parts.pdf",
        state: 3,
        due: 6,
      },
      {
        front: "When is a series conditionally convergent?",
        back: "When ∑aₙ converges but ∑|aₙ| diverges — for example the alternating harmonic series.",
        source: "Series convergence cheatsheet",
        state: 2,
        due: -0.1,
      },
      {
        front: "What does the ratio test conclude when L < 1?",
        back: "The series converges absolutely. When L > 1 it diverges, and L = 1 is inconclusive.",
        source: "Series convergence cheatsheet",
        state: 1,
        due: -1,
      },
      {
        front: "Integrate ∫ln(x) dx.",
        back: "x ln x − x + C, using integration by parts with u = ln x and dv = dx.",
        source: "Stewart §7.1 — Integration by parts.pdf",
        state: 2,
        due: 2,
      },
    ],
  };

  SL.GENERATED_CARDS = {
    "Organic Chemistry": [
      {
        front: "Which alkene is most stable?",
        back: "The most substituted alkene — hyperconjugation stabilizes the π bond and steric strain is reduced.",
        source: "Lecture 04 — Alkenes.pdf",
      },
      {
        front: "What is a carbocation rearrangement?",
        back: "A 1,2-hydride or alkyl shift that converts a less stable carbocation into a more stable one.",
        source: "Reaction mechanisms — summary",
      },
      {
        front: "Which reagent gives anti-Markovnikov HBr addition?",
        back: "HBr with peroxides, via a radical mechanism, places Br on the less substituted carbon.",
        source: "Khan Academy — Electrophilic addition",
      },
    ],
    "World History": [
      {
        front: "When was the Treaty of Versailles signed?",
        back: "28 June 1919, in the Hall of Mirrors at the Palace of Versailles.",
        source: "Treaty of Versailles notes",
      },
      {
        front: "What was the Dawes Plan?",
        back: "A 1924 US loan program that rescheduled German reparations and stabilized the Weimar economy.",
        source: "Ch. 12 — The Great War.pdf",
      },
      {
        front: "Define total war.",
        back: "Conflict that mobilizes a society's entire population and economy, not just its military.",
        source: "Crash Course — WWI",
      },
    ],
    "Calculus II": [
      {
        front: "What is ∫tan(x) dx?",
        back: "−ln|cos x| + C, equivalently ln|sec x| + C.",
        source: "Stewart §7.1 — Integration by parts.pdf",
      },
      {
        front: "State the alternating series test.",
        back: "If bₙ decreases monotonically to 0, then ∑(−1)ⁿbₙ converges.",
        source: "Series convergence cheatsheet",
      },
      {
        front: "When does a p-series converge?",
        back: "∑1/nᵖ converges when p > 1 and diverges when p ≤ 1.",
        source: "Series convergence cheatsheet",
      },
    ],
  };

  SL.GENERIC_CARDS = [
    {
      front: "What is the central claim of this material?",
      back: "Write the one-sentence thesis, then list the two strongest supporting details from your sources.",
    },
    {
      front: "Which terms in this notebook need a precise definition?",
      back: "Pick the three most load-bearing terms and define each in your own words.",
    },
    {
      front: "What would an exam question about this topic ask?",
      back: "Turn the main idea into a why, a compare, and an apply question, then answer each.",
    },
  ];

  SL.CHAT_LIBRARY = {
    "Organic Chemistry": [
      {
        terms: ["markovnikov"],
        text: "Markovnikov's rule predicts that in HX addition to an alkene, hydrogen adds to the carbon with more hydrogens, giving the more substituted carbocation product.\n\nYour Lecture 04 notes walk through propene: HBr gives 2-bromopropane, not 1-bromopropane. The summary sheet frames it as a competition between carbocation stability and sterics.",
        cites: [0, 1],
      },
      {
        terms: ["stabil", "carbocation", "intermediate"],
        text: "The key intermediate is a carbocation. Stability follows 3° > 2° > 1° > methyl, driven by hyperconjugation and inductive donation from alkyl groups.\n\nThat ordering is why the more substituted product dominates. If a 1,2-hydride or alkyl shift can form a more stable cation, rearrangement becomes competitive.",
        cites: [0, 1],
      },
      {
        terms: ["quiz", "test"],
        text: "Try these three: (1) Predict the major product of HCl addition to 2-methyl-2-butene. (2) Why does peroxide change the regiochemistry of HBr addition? (3) Draw the curly arrows for the first step of electrophilic addition.\n\nAnswer aloud before checking Lecture 04 — recall beats rereading.",
        cites: [0, 2],
      },
      {
        terms: ["summar", "lecture"],
        text: "Lecture 04 covers three ideas: alkenes act as nucleophiles through the π bond; addition proceeds via a carbocation; and regiochemistry is decided by Markovnikov's rule unless radicals intervene.\n\nThe summary sheet adds the exception list — peroxides for HBr, and boron reagents for hydroboration.",
        cites: [0, 1],
      },
    ],
    "World History": [
      {
        terms: ["start", "trigger", "begin", "assassin"],
        text: "The immediate trigger was the assassination of Archduke Franz Ferdinand in Sarajevo on 28 June 1914.\n\nThe deeper causes are usually grouped as militarism, alliances, imperialism, and nationalism. The July Crisis turned a regional dispute into a continental war within five weeks.",
        cites: [0, 2],
      },
      {
        terms: ["231", "guilt", "versailles", "treaty"],
        text: "Article 231 — the war guilt clause — assigned sole responsibility for the war to Germany and its allies. It was the legal basis for reparations.\n\nYour notes emphasize that the clause was as much political as legal: it let the Allies justify payments without fixing a sum in the treaty itself.",
        cites: [1, 0],
      },
      {
        terms: ["marshall", "plan", "rebuild"],
        text: "The Marshall Plan was a US program running from 1948 to 1951 that sent more than $12 billion to rebuild Western European economies.\n\nIts goals were economic recovery, political stability against communist parties, and market integration — which fed into later European cooperation.",
        cites: [0],
      },
      {
        terms: ["league", "fail", "wwii"],
        text: "The League of Nations lacked enforcement power, the United States never joined, and key powers were absent or left. Sanctions were voluntary and unanimity made decisions slow.\n\nBy the 1930s, Japan, Italy, and Germany simply ignored it. The chapter treats this as a design failure rather than one missed moment.",
        cites: [0],
      },
    ],
    "Calculus II": [
      {
        terms: ["parts", "integration", "ln"],
        text: "The formula is ∫u dv = uv − ∫v du. Pick u using LIATE so that du simplifies, and dv so that v is easy to integrate.\n\nFor ∫ln x dx, take u = ln x and dv = dx, giving x ln x − ∫1 dx = x ln x − x + C.",
        cites: [0],
      },
      {
        terms: ["converg", "ratio", "series", "alternating"],
        text: "A series converges absolutely when ∑|aₙ| converges. It is conditionally convergent when ∑aₙ converges but ∑|aₙ| does not — the alternating harmonic series is the canonical example.\n\nYour cheatsheet pairs the ratio test (L < 1 converges, L > 1 diverges, L = 1 inconclusive) with the alternating series test, which needs terms decreasing to zero.",
        cites: [1],
      },
      {
        terms: ["quiz", "test"],
        text: "Three to try: (1) Does ∑n²/2ⁿ converge? (2) Is ∑(−1)ⁿ/√n absolutely convergent? (3) Evaluate ∫x eˣ dx.\n\nThe ratio test gives L = 1/2 for the first. The second is conditional. The third is (x − 1)eˣ + C.",
        cites: [0, 1],
      },
    ],
  };

  SL.SUGGESTIONS = {
    "Organic Chemistry": [
      "Explain Markovnikov's rule",
      "Quiz me on alkenes",
      "Summarize Lecture 04",
    ],
    "World History": [
      "Why did WWI start?",
      "What did Article 231 do?",
      "Summarize the chapter",
    ],
    "Calculus II": [
      "When does a series converge?",
      "Walk me through integration by parts",
      "Quiz me on series tests",
    ],
  };

  SL.GENERIC_SUGGESTIONS = ["Summarize these sources", "Quiz me on this material", "Explain the key idea"];

  SL.seed = function () {
    const now = Date.now();
    const iso = (days) => new Date(now + days * 86400000).toISOString();
    const created = new Date(now - 12 * 86400000).toISOString();

    const notebooks = [
      { id: 1, title: "Organic Chemistry", tone: "tone-sage", createdAt: created },
      { id: 2, title: "World History", tone: "tone-butter", createdAt: created },
      { id: 3, title: "Calculus II", tone: "tone-sky", createdAt: created },
    ];

    const sources = {
      1: [
        { id: 101, kind: "pdf", title: "Lecture 04 — Alkenes.pdf", meta: "24 pages · 86 chunks", createdAt: created },
        { id: 102, kind: "text", title: "Reaction mechanisms — summary", meta: "12 chunks", createdAt: created },
        { id: 103, kind: "youtube", title: "Khan Academy — Electrophilic addition", meta: "18 min · 41 chunks", createdAt: created },
      ],
      2: [
        { id: 201, kind: "pdf", title: "Ch. 12 — The Great War.pdf", meta: "31 pages · 104 chunks", createdAt: created },
        { id: 202, kind: "text", title: "Treaty of Versailles notes", meta: "9 chunks", createdAt: created },
        { id: 203, kind: "youtube", title: "Crash Course — WWI", meta: "13 min · 33 chunks", createdAt: created },
      ],
      3: [
        { id: 301, kind: "pdf", title: "Stewart §7.1 — Integration by parts.pdf", meta: "18 pages · 61 chunks", createdAt: created },
        { id: 302, kind: "text", title: "Series convergence cheatsheet", meta: "7 chunks", createdAt: created },
      ],
    };

    const cards = {};
    const chats = {};
    const generated = {};
    let cardId = 1;

    for (const notebook of notebooks) {
      cards[notebook.id] = SL.NOTEBOOK_CARDS[notebook.title].map((card) => ({
        id: cardId++,
        front: card.front,
        back: card.back,
        source: card.source,
        state: card.state,
        lapses: 0,
        due: iso(card.due),
      }));
      chats[notebook.id] = [];
      generated[notebook.id] = 0;
    }

    return {
      user: null,
      streak: 4,
      reviewedToday: 0,
      notebooks,
      sources,
      cards,
      chats,
      generated,
      settings: { personalKey: false },
    };
  };
})(window.SL);
