/**
 * Every word the app shows, in both languages.
 *
 * English is the source language and the default; Italian is the translation, and it is
 * complete, because the tool is for Turin and is demonstrated to an Italian audience. The
 * Italian strings are the ones the app shipped with, kept to the letter.
 *
 * Components read this through `useCopy()`, which subscribes them to the language, so a
 * switch re-renders them. Pure modules (the planner formats, the memo template) take a
 * `Lang` and call `copyFor`.
 */
import type { Confidence, Lens, Profile, ServiceType, TargetField } from './types';

export type Lang = 'en' | 'it';

export const LANGS: Lang[] = ['en', 'it'];
export const DEFAULT_LANG: Lang = 'en';

/** Number and date formats follow the language, so 100000 is 100,000 or 100.000. */
export const LOCALE: Record<Lang, string> = { en: 'en-GB', it: 'it-IT' };

type Plural = (count: number) => string;

export interface Copy {
  lang: Lang;
  /** Display names for the interventions, by id. The contract's own label is the fallback. */
  interventions: Record<string, string>;
  app: {
    brandLine: string;
    dataAria: string;
    dataLabels: { zones: string; services: string; projects: string; sources: string };
    mockBanner: string;
    loadError: string;
    langAria: string;
    langName: Record<Lang, string>;
  };
  cmd: {
    sectionAria: string;
    inputAria: string;
    placeholder: string;
    answerPlaceholder: string;
    send: string;
    examplesLabel: string;
    examples: { label: string; prompt: string }[];
    modes: Record<'checking' | 'llm' | 'rules' | 'offline', string>;
    interpreting: string;
    askedPrefix: string;
    questionTag: string;
    chipsAria: string;
    plannerStillWorks: string;
  };
  map: {
    lensAria: string;
    legendAria: string;
    cityButton: string;
    servicesTitle: string;
    lenses: Record<Lens, { label: string; note: string }>;
    needScale: string;
    fundedScale: string;
    /** "51 su 100" / "51 of 100": never mistakable for a percentage of funding. */
    outOf: (value: string, max: number) => string;
    notAvailable: string;
    smallZoneTooltip: string;
    sourceLine: (source: string, year: number) => string;
    keys: { inPlan: string; selected: string; excluded: string; missing: string };
    services: Record<ServiceType, { label: string; singular: string }>;
  };
  zone: {
    panelAria: (name: string) => string;
    closeAria: string;
    circ: (n: string) => string;
    inPlan: string;
    smallZone: string;
    sections: { population: string; needs: string; nearby: string; funded: string; sources: string };
    residents: string;
    over65: string;
    over75: string;
    aloneRate: string;
    circFigure: string;
    stability: string;
    nearestHealth: string;
    nearestCare: string;
    nearestPharmacy: string;
    services800: string;
    amount: string;
    projects: string;
    noProjects: string;
    progress: string;
    source: string;
    estimateTag: string;
  };
  planner: {
    profileLabel: string;
    profileTitle: string;
    profiles: Record<Profile, string>;
    budgetLabel: string;
    budgetSliderAria: string;
    weightsLabel: string;
    weightsTotal: string;
    weightsZero: string;
    weightShareAria: (share: number) => string;
    criteria: Record<'isolation' | 'service_gap' | 'future_pressure' | 'inclusion', string>;
    filtersTitle: string;
    circLabel: string;
    allCirc: string;
    circAria: (n: number) => string;
    excludeFunded: string;
    minOver75: string;
    recapAllCirc: string;
    recapOneCirc: (n: number) => string;
    recapManyCirc: (list: string) => string;
    recapNoFunded: string;
    recapMinOver75: (n: string) => string;
    summaryAria: string;
    summary: { used: string; people: string; perPerson: string; zones: string };
    resultsTitle: string;
    interventionCount: Plural;
    metrics: { people: string; perPerson: string; index: string };
    footnote: string;
    overlapNote: string;
    emptyTitle: string;
    emptyBudget: string;
    emptyNoInterventions: string;
    emptyFiltered: string;
    emptyLoading: string;
    emptyError: string;
    clearFilters: string;
    reasons: Record<'isolation' | 'service_gap' | 'future_pressure' | 'inclusion',
      { high: string; medium: string; low: string }>;
    confidence: Record<Confidence, string>;
    targets: Record<TargetField, string>;
    assumptionsTitle: string;
    assumptionsEdited: string;
    assumptionsDefault: string;
    assumptionsNotice: string;
    assumptionsEmpty: string;
    reachLabel: (target: string) => string;
    fixedCost: string;
    costPerPerson: string;
    restore: string;
    generateMemo: string;
  };
  chips: {
    tools: Record<string, string>;
    unknownTool: string;
    ignored: (tool: string) => string;
    profile: (name: string) => string;
    budget: (amount: string) => string;
    weights: (list: string) => string;
    zone: (name: string) => string;
    memo: string;
    plan: (count: string) => string;
    planEmpty: string;
    allCirc: string;
    oneCirc: (n: number) => string;
    manyCirc: (list: string) => string;
    fundedExcluded: string;
    fundedIncluded: string;
    minOver75: (n: string) => string;
    noMinOver75: string;
    updated: string;
    notUnderstood: string;
  };
  memo: {
    title: string;
    profile: string;
    budget: string;
    mockWarning: string;
    letterhead: string;
    mockTag: string;
    dialogTitle: string;
    copy: string;
    copied: string;
    copyFailed: string;
    print: string;
    close: string;
    preparing: string;
    preparingHint: string;
    localMemo: string;
    forbiddenTerm: string;
    byAi: string;
    byRules: string;
    /** Section headings and the prose between them. */
    sections: {
      summary: string;
      where: string;
      why: string;
      funded: string;
      limits: string;
      sources: string;
    };
    summaryOpening: (budget: string, interventions: string, zones: string, used: string) => string;
    unassigned: (amount: string) => string;
    peopleReached: (people: string) => string;
    firstPriority: (label: string, zone: string, circ: number, amount: string, people: string) => string;
    interventionsPlural: Plural;
    zonesPlural: Plural;
    projectsPlural: Plural;
    assumptionsNote: string;
    valuesUsed: string;
    valuesLine: (label: string, share: string, target: string, fixed: string, perPerson: string) => string;
    tableHead: string[];
    indexExplained: (scale: string) => string;
    weightsLine: (weights: string, filters: string) => string;
    zoneDetailHead: (zone: string, circ: number, needs: string) => string;
    over75Of: (over75: string, pop: string) => string;
    over75By2030: (n: string) => string;
    aloneShare: (share: string) => string;
    servicesWithin: (n: string) => string;
    nearestHealth: (d: string) => string;
    nearestCare: (d: string) => string;
    nearestPharmacy: (d: string) => string;
    stability: (share: string) => string;
    moreZones: (n: string) => string;
    coverageScale: string;
    noLocalProjects: string;
    fundedTableHead: string[];
    projectLine: (title: string, zone: string, programme: string, amount: string, progress: string) => string;
    progressSuffix: (pct: string) => string;
    moreProjects: (n: string) => string;
    projectSource: (list: string) => string;
    notPlaced: (parts: string) => string;
    inSameCirc: (count: string, total: string) => string;
    citywide: (count: string, total: string) => string;
    limits: string[];
    reliability: (list: string) => string;
    toVerify: (list: string) => string;
    noSources: string;
    teamAssumptions: string;
    year: (y: number) => string;
    level: (l: string) => string;
    processedOn: (date: string) => string;
    emptyTitle: string;
    emptyIntro: string;
    emptySteps: string;
    emptyBudget: (budget: string) => string;
    emptyNoBudget: string;
    emptyFilters: (filters: string) => string;
    emptyThenAsk: string;
  };
}

const en: Copy = {
  lang: 'en',
  interventions: {
    visite_domiciliari: 'Home visits and companionship',
    hub_prossimita: 'Neighbourhood care hub',
    accesso_salute: 'Digital and health access',
    sicurezza_digitale: 'Digital safety and fraud prevention',
    inserimento_lavoro: 'Work inclusion for over-50s and new residents',
  },
  app: {
    brandLine: 'Where to invest for the greatest social return in Turin',
    dataAria: 'Loaded data',
    dataLabels: { zones: 'zones', services: 'services', projects: 'projects', sources: 'sources' },
    mockBanner: 'TEST DATA',
    loadError: 'Data not loaded: ',
    langAria: 'Language',
    langName: { en: 'EN', it: 'IT' },
  },
  cmd: {
    sectionAria: 'Planner assistant',
    inputAria: 'Request to the planner',
    placeholder: 'E.g. I have 200,000 euro, priority to over-75s living alone, avoid zones already covered by the PNRR',
    answerPlaceholder: 'Type your answer here',
    send: 'Send',
    examplesLabel: 'Examples',
    examples: [
      {
        label: '€200,000 for over-75s living alone, no PNRR',
        prompt: 'I have 200,000 euro, priority to over-75s living alone, avoid zones already covered by the PNRR',
      },
      {
        label: 'Service gap in Circoscrizione 6',
        prompt: 'Budget of 150,000 euro, priority to the service gap in Circoscrizione 6',
      },
      {
        label: 'Inclusion and a memo for the board',
        prompt: 'I have 100,000 euro, priority to inclusion, then prepare the memo for the board',
      },
    ],
    modes: {
      checking: 'Checking AI…',
      llm: 'AI on',
      rules: 'Rules mode',
      offline: 'AI not connected',
    },
    interpreting: 'Reading your request…',
    askedPrefix: 'Request: ',
    questionTag: 'Question',
    chipsAria: 'Changes applied',
    plannerStillWorks: 'The planner still works: budget, priorities and filters stay available in the panel on the right.',
  },
  map: {
    lensAria: 'Map lens',
    legendAria: 'Legend',
    cityButton: 'Whole city',
    servicesTitle: 'Service points',
    lenses: {
      isolation: { label: 'Isolation', note: 'Estimated share of over-75s and people living alone.' },
      service_gap: { label: 'Service gap', note: 'Distance to health and care, few services within 800 m.' },
      future_pressure: { label: 'Future pressure', note: 'Expected growth of over-75s by 2030, a relative signal.' },
      inclusion: { label: 'Inclusion', note: 'Need for access to services and for language support.' },
      funded_share: { label: 'Already funded', note: 'Euro per resident already allocated, normalised.' },
    },
    needScale: 'Score 0-100: higher means greater need.',
    fundedScale: 'Index 0-1: higher means more funding already in place.',
    outOf: (value, max) => `${value} of ${max}`,
    notAvailable: 'n/a',
    smallZoneTooltip: 'Small zone: excluded from the ranking',
    sourceLine: (source, year) => `Source: ${source}, ${year}`,
    keys: {
      inPlan: 'Zone in the plan',
      selected: 'Selected zone',
      excluded: 'Excluded from the ranking',
      missing: 'Data not available',
    },
    services: {
      hospital: { label: 'Hospitals', singular: 'Hospital' },
      rsa: { label: 'Care homes', singular: 'Care home' },
      pharmacy: { label: 'Pharmacies', singular: 'Pharmacy' },
      library: { label: 'Libraries', singular: 'Library' },
      market: { label: 'Markets', singular: 'Market' },
    },
  },
  zone: {
    panelAria: (name) => `Zone card ${name}`,
    closeAria: 'Close zone card',
    circ: (n) => `Circoscrizione ${n}`,
    inPlan: 'In the plan',
    smallZone: 'Small zone, under 1,000 residents: excluded from the ranking.',
    sections: {
      population: 'Population',
      needs: 'Need scores (0-100)',
      nearby: 'Closeness to services',
      funded: 'Already funded',
      sources: 'Sources and data year',
    },
    residents: 'Residents 2025',
    over65: 'Over 65',
    over75: 'Over 75',
    aloneRate: 'Living alone',
    circFigure: 'Circoscrizione figure',
    stability: 'Stays in the top 10 under random weights',
    nearestHealth: 'Nearest health facility',
    nearestCare: 'Nearest care home',
    nearestPharmacy: 'Nearest pharmacy',
    services800: 'Services within 800 m',
    amount: 'Amount',
    projects: 'Projects',
    noProjects: 'No project located in this zone.',
    progress: 'Progress',
    source: 'Source',
    estimateTag: 'est.',
  },
  planner: {
    profileLabel: 'Profile',
    profileTitle: 'The profile goes to the assistant and the memo; it does not change the ranking.',
    profiles: { foundation: 'Foundation', third_sector: 'Third sector', institution: 'Institution' },
    budgetLabel: 'Budget',
    budgetSliderAria: 'Budget, slider',
    weightsLabel: 'Priorities',
    weightsTotal: 'Share of the total',
    weightsZero: 'Weights at zero: criteria count equally',
    weightShareAria: (share) => `${share}% of the total`,
    criteria: {
      isolation: 'Isolation',
      service_gap: 'Service gap',
      future_pressure: 'Future pressure',
      inclusion: 'Inclusion',
    },
    filtersTitle: 'Filters',
    circLabel: 'Circoscrizione',
    allCirc: 'All',
    circAria: (n) => `Circoscrizione ${n}`,
    excludeFunded: 'Exclude zones already funded',
    minOver75: 'Minimum over-75s per zone',
    recapAllCirc: 'All circoscrizioni',
    recapOneCirc: (n) => `Circoscrizione ${n}`,
    recapManyCirc: (list) => `Circoscrizioni ${list}`,
    recapNoFunded: 'without funded zones',
    recapMinOver75: (n) => `at least ${n} over 75`,
    summaryAria: 'Plan summary',
    summary: { used: 'allocated', people: 'people (est.)', perPerson: 'average per person', zones: 'zones' },
    resultsTitle: 'Proposed portfolio',
    interventionCount: (n) => (n === 1 ? '1 intervention' : `${n} interventions`),
    metrics: { people: 'people', perPerson: 'per person', index: 'expected return index' },
    footnote: 'The expected return index counts the people reached, weighted by the benefit of the '
      + 'intervention, the need of the zone and additionality, per €1,000 of cost. It is an estimate '
      + 'for comparing options, not a measured return.',
    overlapNote: ' In zones with more than one intervention the same person may be counted twice.',
    emptyTitle: 'No intervention in the plan',
    emptyBudget: 'No intervention is fundable with this budget. Try raising it.',
    emptyNoInterventions: 'There are no interventions to assess.',
    emptyFiltered: 'No zone meets the filters with this budget. Loosen the filters or raise the budget.',
    emptyLoading: 'Loading the zone data…',
    emptyError: 'Data not available: the plan cannot be computed.',
    clearFilters: 'Clear the filters',
    reasons: {
      isolation: { high: 'Severe isolation', medium: 'Moderate isolation', low: 'Low isolation' },
      service_gap: { high: 'Severe service gap', medium: 'Moderate service gap', low: 'Small service gap' },
      future_pressure: { high: 'Strong future pressure', medium: 'Moderate future pressure', low: 'Low future pressure' },
      inclusion: { high: 'Strong inclusion need', medium: 'Moderate inclusion need', low: 'Low inclusion need' },
    },
    confidence: { official: 'Official data', estimated: 'Estimate', low: 'Low reliability' },
    targets: { over75_est: 'over 75', over65_est: 'over 65', adults_50_64_est: 'adults 50-64' },
    assumptionsTitle: 'Intervention assumptions',
    assumptionsEdited: 'Edited',
    assumptionsDefault: 'Team assumptions',
    assumptionsNotice: 'These values are team assumptions, not official data. If you change them the '
      + 'plan updates at once. The benefit per person and the fit to needs, used in the index and not '
      + 'editable here, are team assumptions too.',
    assumptionsEmpty: 'No intervention available.',
    reachLabel: (target) => `Share of ${target} reached`,
    fixedCost: 'Fixed cost',
    costPerPerson: 'Cost per person',
    restore: 'Restore the original assumptions',
    generateMemo: 'Generate memo',
  },
  chips: {
    tools: {
      set_profile: 'profile',
      set_budget: 'budget',
      set_weights: 'priorities',
      filter_zones: 'filters',
      run_plan: 'plan recalculation',
      select_zone: 'zone selection',
      write_memo: 'memo',
    },
    unknownTool: 'not recognised',
    ignored: (tool) => `Action ignored: ${tool}`,
    profile: (name) => `Profile: ${name}`,
    budget: (amount) => `Budget: ${amount}`,
    weights: (list) => `Priorities: ${list}`,
    zone: (name) => `Zone: ${name}`,
    memo: 'Memo being prepared',
    plan: (count) => `Plan: ${count}`,
    planEmpty: 'Plan: no intervention',
    allCirc: 'All circoscrizioni',
    oneCirc: (n) => `Circoscrizione ${n}`,
    manyCirc: (list) => `Circoscrizioni ${list}`,
    fundedExcluded: 'Funded zones excluded',
    fundedIncluded: 'Funded zones included',
    minOver75: (n) => `At least ${n} over 75 per zone`,
    noMinOver75: 'No minimum of over-75s',
    updated: 'I have updated the plan.',
    notUnderstood: 'I did not understand the request: could you rephrase it?',
  },
  memo: {
    title: 'Funding memo',
    profile: 'Profile',
    budget: 'Budget',
    mockWarning: '**Test data:** the figures in this memo are simulated. Do not use them for real decisions.',
    letterhead: 'Bussola · Turin',
    mockTag: 'TEST DATA',
    dialogTitle: 'Funding memo',
    copy: 'Copy',
    copied: 'Copied',
    copyFailed: 'Copy failed',
    print: 'Print',
    close: 'Close',
    preparing: 'Preparing the memo from the plan data…',
    preparingHint: 'This can take up to 30 seconds.',
    localMemo: 'Memo generated locally from the plan data.',
    forbiddenTerm: 'The server text used a term that is not allowed.',
    byAi: 'Text written by the AI from the plan data.',
    byRules: 'Standard server text, based on the plan data.',
    sections: {
      summary: '## Summary',
      where: '## Where to invest',
      why: '## Why these zones',
      funded: '## What is already funded',
      limits: '## Limits of the data',
      sources: '## Sources',
    },
    summaryOpening: (budget, interventions, zones, used) =>
      `With a budget of **${budget}** the plan proposes **${interventions}** in **${zones}** `
      + `of Turin and allocates **${used}**.`,
    unassigned: (amount) => `${amount} remains unassigned.`,
    peopleReached: (people) => `The people reached are about **${people}** (estimate).`,
    firstPriority: (label, zone, circ, amount, people) =>
      `First priority: **${label}** in **${zone}** (Circoscrizione ${circ}), with ${amount} `
      + `for about ${people} people.`,
    interventionsPlural: (n) => (n === 1 ? 'intervention' : 'interventions'),
    zonesPlural: (n) => (n === 1 ? 'zone' : 'zones'),
    projectsPlural: (n) => (n === 1 ? 'project' : 'projects'),
    assumptionsNote: '**Note on the assumptions:** costs, shares of people reached, benefit per person '
      + 'and fit to needs are working assumptions of the team, not quotes and not measured data. '
      + 'Costs and shares can be changed in the planner. '
      + 'People reached and cost per person are therefore estimates.',
    valuesUsed: '**Values used.**',
    valuesLine: (label, share, target, fixed, perPerson) =>
      `${label}: ${share} of ${target}, ${fixed} fixed and ${perPerson} per person`,
    tableHead: ['Zone', 'Intervention', 'Budget', 'People (est.)', 'Cost per person (assumed)', 'Expected return index', 'Data'],
    indexExplained: (scale) =>
      'Zone-intervention pairs are ordered by **expected return index**: it counts the people reached, '
      + `weighted by the benefit of the intervention, the need of the zone and additionality, per ${scale} `
      + 'of cost. It is an estimate for comparing options, not a measured return.',
    weightsLine: (weights, filters) =>
      `**Need weights:** ${weights}. **Filters:** ${filters}. Scores run from 0 to 100: higher means greater need.`,
    zoneDetailHead: (zone, circ, needs) => `- **${zone}** (Circoscrizione ${circ}): ${needs}.`,
    over75Of: (over75, pop) => `Estimated over-75s: ${over75} of ${pop} residents`,
    over75By2030: (n) => `${n} estimated by 2030`,
    aloneShare: (share) => `${share} live alone (Circoscrizione figure)`,
    servicesWithin: (n) => `services within 800 m: ${n}`,
    nearestHealth: (d) => `nearest health facility ${d} away`,
    nearestCare: (d) => `nearest care home ${d} away`,
    nearestPharmacy: (d) => `nearest pharmacy ${d} away`,
    stability: (share) => `stays in the top 10 under random weights in ${share} of cases`,
    moreZones: (n) => `The other ${n} zones in the plan are in the table above.`,
    coverageScale: 'Relative coverage runs from 0 (no funding) to 1 (the most funded zone per resident).',
    noLocalProjects: 'No located project is recorded in the zones of the plan.',
    fundedTableHead: ['Zone', 'Already funded', 'Projects', 'Relative coverage'],
    projectLine: (title, zone, programme, amount, progress) =>
      `- **${title}** (${zone}, ${programme}): ${amount}${progress}.`,
    progressSuffix: (pct) => `, progress ${pct}`,
    moreProjects: (n) => `There are ${n} further projects in the same zones.`,
    projectSource: (list) => `Source of the projects: ${list}.`,
    notPlaced: (parts) => `Not attributed to a single zone: ${parts}.`,
    inSameCirc: (count, total) => `in the same circoscrizioni ${count}, ${total}`,
    citywide: (count, total) => `citywide ${count}, ${total}`,
    limits: [
      '- **Population by age:** over 65, over 75 and adults 50-64 are estimates per zone, not official counts.',
      '- **People living alone:** the figure is per Circoscrizione and covers all ages, so it is the same in every zone of the same Circoscrizione.',
      '- **Future pressure:** a relative signal, not a forecast, because it does not account for migration and deaths.',
      '- **Funding:** projects that cannot be located stay at city level. Relative coverage compares zones with each other: it does not say how much of the need is covered.',
      '- **Inclusion:** the share of foreign residents indicates a need for access and language, never a risk.',
      '- **Small zones:** excluded from the ranking because the estimates would be unstable.',
    ],
    reliability: (list) => `- **Reliability of the zones in the plan:** ${list}.`,
    toVerify: (list) => `- **To verify before deliberating:** ${list}.`,
    noSources: '- No source given in the metadata.',
    teamAssumptions: '- Costs, shares, benefit per person and fit to needs: working assumptions of the team.',
    year: (y) => `year ${y}`,
    level: (l) => `level ${l}`,
    processedOn: (date) => `Data processed on ${date}.`,
    emptyTitle: '# Memo not available yet',
    emptyIntro: 'The plan is empty, so there is nothing to put to the board yet.',
    emptySteps: 'To generate the memo:',
    emptyBudget: (budget) =>
      `Check the budget: with ${budget} there may be no room for any intervention. Try raising it.`,
    emptyNoBudget: 'Set a budget above zero, in the panel on the right or by writing it in the bar at the top.',
    emptyFilters: (filters) => `Loosen the active filters (${filters}).`,
    emptyThenAsk: 'When the proposed portfolio appears in the panel on the right, ask for the memo again.',
  },
};

const it: Copy = {
  lang: 'it',
  interventions: {
    visite_domiciliari: 'Visite e compagnia a domicilio',
    hub_prossimita: 'Hub di prossimità e cura',
    accesso_salute: 'Accesso digitale e sanitario',
    sicurezza_digitale: 'Sicurezza digitale e anti-truffa',
    inserimento_lavoro: 'Inserimento lavorativo over 50 e nuovi residenti',
  },
  app: {
    brandLine: 'Dove investire per il massimo ritorno sociale a Torino',
    dataAria: 'Dati caricati',
    dataLabels: { zones: 'zone', services: 'servizi', projects: 'progetti', sources: 'fonti' },
    mockBanner: 'DATI DI PROVA',
    loadError: 'Dati non caricati: ',
    langAria: 'Lingua',
    langName: { en: 'EN', it: 'IT' },
  },
  cmd: {
    sectionAria: 'Assistente del planner',
    inputAria: 'Richiesta al planner',
    placeholder: 'Es. ho 200.000 euro, priorità agli over 75 soli, evita le zone già coperte dal PNRR',
    answerPlaceholder: 'Scrivi qui la risposta',
    send: 'Invia',
    examplesLabel: 'Esempi',
    examples: [
      {
        label: '200.000 € per gli over 75 soli, senza PNRR',
        prompt: 'Ho 200.000 euro, priorità agli over 75 soli, evita le zone già coperte dal PNRR',
      },
      {
        label: 'Carenza di servizi in Circoscrizione 6',
        prompt: 'Budget di 150.000 euro, priorità alla carenza di servizi nella Circoscrizione 6',
      },
      {
        label: 'Inclusione e memo per il consiglio',
        prompt: 'Ho 100.000 euro, priorità all\'inclusione, poi prepara il memo per il consiglio',
      },
    ],
    modes: {
      checking: 'Verifica AI…',
      llm: 'AI attiva',
      rules: 'Modalità regole',
      offline: 'AI non connessa',
    },
    interpreting: 'Sto interpretando la richiesta…',
    askedPrefix: 'Richiesta: ',
    questionTag: 'Domanda',
    chipsAria: 'Modifiche applicate',
    plannerStillWorks: 'Il planner funziona comunque: budget, pesi e filtri restano disponibili nel pannello a destra.',
  },
  map: {
    lensAria: 'Lente della mappa',
    legendAria: 'Legenda',
    cityButton: 'Tutta la città',
    servicesTitle: 'Punti di servizio',
    lenses: {
      isolation: { label: 'Isolamento', note: 'Quota stimata di over 75 e persone che vivono sole.' },
      service_gap: { label: 'Carenza servizi', note: 'Distanza da sanità e cura, pochi servizi entro 800 m.' },
      future_pressure: { label: 'Pressione futura', note: 'Crescita attesa degli over 75 al 2030, segnale relativo.' },
      inclusion: { label: 'Inclusione', note: 'Bisogno di accesso ai servizi e di supporto linguistico.' },
      funded_share: { label: 'Già finanziato', note: 'Euro per residente già assegnati, normalizzati.' },
    },
    needScale: 'Punteggio 0-100: più alto, più bisogno.',
    fundedScale: 'Indice 0-1: più alto, più fondi già presenti.',
    outOf: (value, max) => `${value} su ${max}`,
    notAvailable: 'n.d.',
    smallZoneTooltip: 'Zona piccola: esclusa dalla classifica',
    sourceLine: (source, year) => `Fonte: ${source}, ${year}`,
    keys: {
      inPlan: 'Zona nel piano',
      selected: 'Zona selezionata',
      excluded: 'Esclusa dalla classifica',
      missing: 'Dato non disponibile',
    },
    services: {
      hospital: { label: 'Ospedali', singular: 'Ospedale' },
      rsa: { label: 'RSA', singular: 'RSA' },
      pharmacy: { label: 'Farmacie', singular: 'Farmacia' },
      library: { label: 'Biblioteche', singular: 'Biblioteca' },
      market: { label: 'Mercati', singular: 'Mercato' },
    },
  },
  zone: {
    panelAria: (name) => `Scheda zona ${name}`,
    closeAria: 'Chiudi scheda zona',
    circ: (n) => `Circoscrizione ${n}`,
    inPlan: 'Nel piano',
    smallZone: 'Zona piccola, sotto 1.000 residenti: esclusa dalla classifica.',
    sections: {
      population: 'Popolazione',
      needs: 'Punteggi di bisogno (0-100)',
      nearby: 'Vicinanza ai servizi',
      funded: 'Già finanziato',
      sources: 'Fonti e anno dei dati',
    },
    residents: 'Residenti 2025',
    over65: 'Over 65',
    over75: 'Over 75',
    aloneRate: 'Vivono sole',
    circFigure: 'dato di Circoscrizione',
    stability: 'Resta tra le prime 10 con pesi casuali',
    nearestHealth: 'Presidio sanitario più vicino',
    nearestCare: 'Struttura di cura più vicina',
    nearestPharmacy: 'Farmacia più vicina',
    services800: 'Servizi entro 800 m',
    amount: 'Importo',
    projects: 'Progetti',
    noProjects: 'Nessun progetto localizzato in questa zona.',
    progress: 'Avanzamento',
    source: 'Fonte',
    estimateTag: 'stima',
  },
  planner: {
    profileLabel: 'Profilo',
    profileTitle: 'Il profilo va all\'assistente e al memo; non cambia la classifica.',
    profiles: { foundation: 'Fondazione', third_sector: 'Terzo settore', institution: 'Istituzione' },
    budgetLabel: 'Budget',
    budgetSliderAria: 'Budget, cursore',
    weightsLabel: 'Priorità',
    weightsTotal: 'Percentuale sul totale',
    weightsZero: 'Pesi a zero: criteri alla pari',
    weightShareAria: (share) => `${share}% del totale`,
    criteria: {
      isolation: 'Isolamento',
      service_gap: 'Carenza servizi',
      future_pressure: 'Pressione futura',
      inclusion: 'Inclusione',
    },
    filtersTitle: 'Filtri',
    circLabel: 'Circoscrizione',
    allCirc: 'Tutte',
    circAria: (n) => `Circoscrizione ${n}`,
    excludeFunded: 'Escludi zone già finanziate',
    minOver75: 'Minimo over 75 per zona',
    recapAllCirc: 'Tutte le circoscrizioni',
    recapOneCirc: (n) => `Circoscrizione ${n}`,
    recapManyCirc: (list) => `Circoscrizioni ${list}`,
    recapNoFunded: 'senza zone finanziate',
    recapMinOver75: (n) => `almeno ${n} over 75`,
    summaryAria: 'Sintesi del piano',
    summary: { used: 'impiegati', people: 'persone (stima)', perPerson: 'media a persona', zones: 'zone' },
    resultsTitle: 'Portafoglio proposto',
    interventionCount: (n) => (n === 1 ? '1 intervento' : `${n} interventi`),
    metrics: { people: 'persone', perPerson: 'a persona', index: 'indice di ritorno atteso' },
    footnote: 'L\'indice di ritorno atteso conta le persone raggiunte, pesate per beneficio '
      + 'dell\'intervento, bisogno della zona e addizionalità, ogni 1.000 € di costo. È una stima '
      + 'per confrontare le opzioni, non un ritorno misurato.',
    overlapNote: ' Nelle zone con più interventi la stessa persona può essere contata più volte.',
    emptyTitle: 'Nessun intervento nel piano',
    emptyBudget: 'Con questo budget nessun intervento è finanziabile. Prova ad aumentarlo.',
    emptyNoInterventions: 'Non ci sono interventi da valutare.',
    emptyFiltered: 'Nessuna zona rispetta i filtri con questo budget. Allenta i filtri o aumenta il budget.',
    emptyLoading: 'Caricamento dei dati delle zone…',
    emptyError: 'Dati non disponibili: il piano non si può calcolare.',
    clearFilters: 'Azzera i filtri',
    reasons: {
      isolation: { high: 'Forte isolamento', medium: 'Isolamento medio', low: 'Isolamento basso' },
      service_gap: {
        high: 'Forte carenza di servizi', medium: 'Carenza di servizi media', low: 'Carenza di servizi bassa',
      },
      future_pressure: {
        high: 'Forte pressione futura', medium: 'Pressione futura media', low: 'Pressione futura bassa',
      },
      inclusion: {
        high: 'Forte bisogno di inclusione',
        medium: 'Bisogno di inclusione medio',
        low: 'Bisogno di inclusione basso',
      },
    },
    confidence: { official: 'Dato ufficiale', estimated: 'Stima', low: 'Affidabilità bassa' },
    targets: { over75_est: 'over 75', over65_est: 'over 65', adults_50_64_est: 'adulti 50-64' },
    assumptionsTitle: 'Ipotesi sugli interventi',
    assumptionsEdited: 'Modificate',
    assumptionsDefault: 'Ipotesi del team',
    assumptionsNotice: 'Questi valori sono ipotesi del team, non dati ufficiali. Se li modifichi, il piano si '
      + 'aggiorna subito. Sono ipotesi del team anche il beneficio per persona e l\'aderenza ai '
      + 'bisogni, usati nell\'indice e non modificabili qui.',
    assumptionsEmpty: 'Nessun intervento disponibile.',
    reachLabel: (target) => `Quota di ${target} raggiunta`,
    fixedCost: 'Costo fisso',
    costPerPerson: 'Costo per persona',
    restore: 'Ripristina le ipotesi iniziali',
    generateMemo: 'Genera memo',
  },
  chips: {
    tools: {
      set_profile: 'profilo',
      set_budget: 'budget',
      set_weights: 'pesi',
      filter_zones: 'filtri',
      run_plan: 'ricalcolo del piano',
      select_zone: 'selezione della zona',
      write_memo: 'memo',
    },
    unknownTool: 'non riconosciuta',
    ignored: (tool) => `Azione ignorata: ${tool}`,
    profile: (name) => `Profilo: ${name}`,
    budget: (amount) => `Budget: ${amount}`,
    weights: (list) => `Pesi: ${list}`,
    zone: (name) => `Zona: ${name}`,
    memo: 'Memo in preparazione',
    plan: (count) => `Piano: ${count}`,
    planEmpty: 'Piano: nessun intervento',
    allCirc: 'Tutte le Circoscrizioni',
    oneCirc: (n) => `Circoscrizione ${n}`,
    manyCirc: (list) => `Circoscrizioni ${list}`,
    fundedExcluded: 'Escluse le zone già finanziate',
    fundedIncluded: 'Incluse le zone già finanziate',
    minOver75: (n) => `Almeno ${n} over 75 per zona`,
    noMinOver75: 'Nessun minimo di over 75',
    updated: 'Ho aggiornato il piano.',
    notUnderstood: 'Non ho capito la richiesta: puoi riformularla?',
  },
  memo: {
    title: 'Memo di finanziamento',
    profile: 'Profilo',
    budget: 'Budget',
    mockWarning: '**Dati di prova:** le cifre di questo memo sono simulate. Non usarle per decisioni reali.',
    letterhead: 'Bussola · Torino',
    mockTag: 'DATI DI PROVA',
    dialogTitle: 'Memo di finanziamento',
    copy: 'Copia',
    copied: 'Copiato',
    copyFailed: 'Copia non riuscita',
    print: 'Stampa',
    close: 'Chiudi',
    preparing: 'Sto preparando il memo dai dati del piano…',
    preparingHint: 'Può richiedere fino a 30 secondi.',
    localMemo: 'Memo generato in locale dai dati del piano.',
    forbiddenTerm: 'Il testo del server usava un termine non ammesso.',
    byAi: 'Testo redatto dall\'AI sui dati del piano.',
    byRules: 'Testo standard del server, basato sui dati del piano.',
    sections: {
      summary: '## Sintesi',
      where: '## Dove investire',
      why: '## Perché queste zone',
      funded: '## Cosa è già finanziato',
      limits: '## Limiti dei dati',
      sources: '## Fonti',
    },
    summaryOpening: (budget, interventions, zones, used) =>
      `Con un budget di **${budget}** il piano propone **${interventions}** in **${zones}** `
      + `di Torino e impiega **${used}**.`,
    unassigned: (amount) => `Restano da assegnare ${amount}.`,
    peopleReached: (people) => `Le persone raggiunte sono circa **${people}** (stima).`,
    firstPriority: (label, zone, circ, amount, people) =>
      `Prima priorità: **${label}** a **${zone}** (Circoscrizione ${circ}), con ${amount} `
      + `per circa ${people} persone.`,
    interventionsPlural: (n) => (n === 1 ? 'intervento' : 'interventi'),
    zonesPlural: (n) => (n === 1 ? 'zona' : 'zone'),
    projectsPlural: (n) => (n === 1 ? 'progetto' : 'progetti'),
    assumptionsNote: '**Nota sulle ipotesi:** costi, quote di persone raggiunte, beneficio per persona e '
      + 'aderenza ai bisogni sono ipotesi di lavoro del team, non preventivi né dati misurati. '
      + 'Costi e quote si possono modificare nel planner. '
      + 'Per questo persone raggiunte e costo per persona sono stime.',
    valuesUsed: '**Valori usati.**',
    valuesLine: (label, share, target, fixed, perPerson) =>
      `${label}: ${share} degli ${target}, ${fixed} fissi e ${perPerson} a persona`,
    tableHead: ['Zona', 'Intervento', 'Budget', 'Persone (stima)', 'Costo per persona (ipotesi)', 'Indice di ritorno atteso', 'Dati'],
    indexExplained: (scale) =>
      'Le coppie zona-intervento sono ordinate per **indice di ritorno atteso**: conta le persone '
      + 'raggiunte, pesate per beneficio dell\'intervento, bisogno della zona e addizionalità, '
      + `ogni ${scale} di costo. `
      + 'È una stima per confrontare le opzioni, non un ritorno misurato.',
    weightsLine: (weights, filters) =>
      `**Pesi del bisogno:** ${weights}. **Filtri:** ${filters}. `
      + 'I punteggi vanno da 0 a 100: più alto significa più bisogno.',
    zoneDetailHead: (zone, circ, needs) => `- **${zone}** (Circoscrizione ${circ}): ${needs}.`,
    over75Of: (over75, pop) => `Over 75 stimati: ${over75} su ${pop} residenti`,
    over75By2030: (n) => `${n} stimati al 2030`,
    aloneShare: (share) => `vive solo il ${share} (dato di Circoscrizione)`,
    servicesWithin: (n) => `servizi entro 800 m: ${n}`,
    nearestHealth: (d) => `presidio sanitario più vicino a ${d}`,
    nearestCare: (d) => `struttura di cura più vicina a ${d}`,
    nearestPharmacy: (d) => `farmacia più vicina a ${d}`,
    stability: (share) => `resta tra le prime 10 con pesi casuali nel ${share} dei casi`,
    moreZones: (n) => `Le altre ${n} zone del piano sono nella tabella qui sopra.`,
    coverageScale: 'La copertura relativa va da 0 (nessun finanziamento) a 1 (la zona più finanziata per residente).',
    noLocalProjects: 'Nelle zone del piano non risultano progetti già localizzati.',
    fundedTableHead: ['Zona', 'Già finanziato', 'Progetti', 'Copertura relativa'],
    projectLine: (title, zone, programme, amount, progress) =>
      `- **${title}** (${zone}, ${programme}): ${amount}${progress}.`,
    progressSuffix: (pct) => `, avanzamento ${pct}`,
    moreProjects: (n) => `Nelle stesse zone ci sono altri ${n} progetti.`,
    projectSource: (list) => `Fonte dei progetti: ${list}.`,
    notPlaced: (parts) => `Non attribuiti a una singola zona: ${parts}.`,
    inSameCirc: (count, total) => `nelle stesse Circoscrizioni ${count}, ${total}`,
    citywide: (count, total) => `a livello cittadino ${count}, ${total}`,
    limits: [
      '- **Popolazione per età:** over 65, over 75 e adulti 50-64 sono stime per zona, non conteggi ufficiali.',
      '- **Persone che vivono sole:** il dato è di Circoscrizione e copre tutte le età, quindi è uguale in tutte le zone della stessa Circoscrizione.',
      '- **Pressione futura:** è un segnale relativo, non una previsione, perché non considera migrazioni e decessi.',
      '- **Finanziamenti:** i progetti non localizzabili restano a livello cittadino. La copertura relativa confronta le zone tra loro: non dice quanta parte del bisogno è coperta.',
      '- **Inclusione:** la quota di residenti stranieri indica un bisogno di accesso e di lingua, mai un rischio.',
      '- **Zone piccole:** sono escluse dalla classifica perché le stime sarebbero instabili.',
    ],
    reliability: (list) => `- **Affidabilità delle zone del piano:** ${list}.`,
    toVerify: (list) => `- **Da verificare prima di deliberare:** ${list}.`,
    noSources: '- Nessuna fonte indicata nei metadati.',
    teamAssumptions: '- Costi, quote, beneficio per persona e aderenza ai bisogni: ipotesi di lavoro del team.',
    year: (y) => `anno ${y}`,
    level: (l) => `livello ${l}`,
    processedOn: (date) => `Dati elaborati il ${date}.`,
    emptyTitle: '# Memo non ancora disponibile',
    emptyIntro: 'Il piano è vuoto, quindi non c\'è ancora nulla da presentare al consiglio.',
    emptySteps: 'Per generare il memo:',
    emptyBudget: (budget) =>
      `Controlla il budget: con ${budget} potrebbe non esserci spazio per nessun intervento. Prova ad aumentarlo.`,
    emptyNoBudget: 'Imposta un budget maggiore di zero, nel pannello a destra o scrivendolo nella barra in alto.',
    emptyFilters: (filters) => `Allenta i filtri attivi (${filters}).`,
    emptyThenAsk: 'Quando il portafoglio proposto compare nel pannello a destra, chiedi di nuovo il memo.',
  },
};

const DICTIONARY: Record<Lang, Copy> = { en, it };

export const copyFor = (lang: Lang): Copy => DICTIONARY[lang] ?? DICTIONARY[DEFAULT_LANG];

/** The name to show for an intervention; the contract's label if the id is unknown. */
export const interventionLabel = (id: string, fallback: string, lang: Lang): string =>
  copyFor(lang).interventions[id] ?? fallback;

export const isLang = (value: unknown): value is Lang => value === 'en' || value === 'it';
